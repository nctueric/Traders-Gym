import { requireSitesTrialUser } from "../lib/sites-trial-auth.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
import { sqliteAdapter } from "../server/sqlite-adapter.mjs";
import { createLocalRecordStore } from "../server/local-record-store.mjs";
import { createAccountApi } from "../lib/account-api.mjs";
import { COOKIE_NAME, OWNER_EMAIL, emptyDataset, requireSession, sessionCookie, sha256, signIn, verifyGoogleCredential, verifyGoogleCsrf } from "../lib/auth-core.mjs";
import { createSessionScope } from "../lib/account-client.mjs";
import { readPendingRecord, writeLocalRecord } from "../lib/trade-record-client.mjs";

function setup(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close()); sqlite.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);
  const migrations = readdirSync(directory).filter(name => name.endsWith(".sql")).sort();
  sqlite.exec(readFileSync(new URL(migrations[0], directory), "utf8"));
  const original = { ...emptyDataset(), privateEvidence: "owner private evidence", fills: [], futureField: { proof: true } };
  sqlite.prepare("INSERT INTO trade_account_snapshots VALUES (?, ?, ?, ?, ?)").run("primary", "Trader X2", JSON.stringify(original), 37, "2026-09-01T00:00:00Z");
  for (const name of migrations.slice(1)) sqlite.exec(readFileSync(new URL(name, directory), "utf8"));
  const db = sqliteAdapter(sqlite), api = createAccountApi({ db, clientId: "fixture", ...options });
  const login = async (email, sub = email) => {
    const session = await signIn(db, { email, sub, name: email, email_verified: true });
    return { ...session, email };
  };
  const request = (session, path, body, method) => new Request(`https://app.example${path}`, {
    method: method || (body ? "POST" : "GET"), headers: { ...(session ? { Cookie: `${COOKIE_NAME}=${session.token}`, "x-workspace-session": session.sessionId } : {}), Origin: "https://app.example", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const call = async (session, path, body, method) => { const response = await api.handle(request(session, path, body, method)); return { status: response.status, body: await response.json(), response }; };
  return { sqlite, db, api, original, login, request, call };
}

test("migration preserves legacy JSON/version; only verified owner claims primary", async t => {
  const h = setup(t);
  assert.equal(h.sqlite.prepare("SELECT owner_user_id FROM trade_account_snapshots").get().owner_user_id, null);
  const owner = await h.login(OWNER_EMAIL, "google-owner");
  const result = await h.call(owner, "/api/trade-records");
  assert.equal(result.status, 200); assert.equal(result.body.account.version, 37); assert.deepEqual(result.body.dataset, h.original);
  const again = await h.login(OWNER_EMAIL, "google-owner");
  assert.equal(again.userId, owner.userId);
  await assert.rejects(h.login(OWNER_EMAIL, "different-google-sub"));
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM system_owner").get().n, 1);
});

test("anonymous and uninvited accounts cannot create or read records", async t => {
  const h = setup(t);
  for (const path of ["/api/trade-records", "/api/auth/session", "/api/admin/accounts", "/api/admin/events"]) assert.equal((await h.call(null, path)).status, 401);
  await assert.rejects(h.login("stranger@gmail.com"), { status: 403 });
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM app_users").get().n, 0);
});

test("invitations provision one private JSON and cannot grant owner privileges", async t => {
  const h = setup(t), owner = await h.login(OWNER_EMAIL);
  assert.equal((await h.call(owner, "/api/admin/accounts", { action: "invite", email: "  Friend@Gmail.com  ", role: "ADMIN" })).status, 200);
  const friend = await h.login("friend@gmail.com"), record = await h.call(friend, "/api/trade-records");
  assert.equal(record.status, 200); assert.deepEqual(record.body.dataset, emptyDataset()); assert.equal(record.body.accounts.length, 1);
  assert.equal((await h.call(friend, "/api/trade-records?accountId=primary")).status, 403);
  assert.equal((await h.call(friend, "/api/trade-records", { accountId: "primary", dataset: h.original }, "PUT")).status, 403);
  assert.equal((await h.call(friend, "/api/admin/accounts")).status, 403);
  assert.equal((await h.call(friend, "/api/admin/events")).status, 403);
  assert.equal((await h.call(friend, "/api/admin/accounts", { action: "invite", email: "new@gmail.com" })).status, 403);
  const session = await h.call(friend, "/api/auth/session"); assert.equal(session.body.user.isOwner, false);
  const admin = await h.call(owner, "/api/admin/accounts"); assert.ok(!JSON.stringify(admin.body).includes("privateEvidence"));
  for (const action of ["disable", "enable", "revoke_invite", "revoke_sessions", "invite"]) assert.equal((await h.call(owner, "/api/admin/accounts", { action, email: OWNER_EMAIL })).status, 403);
});

test("disable revokes all sessions, restore needs fresh login, revoke pending invites", async t => {
  const h = setup(t), owner = await h.login(OWNER_EMAIL);
  await h.call(owner, "/api/admin/accounts", { action: "invite", email: "friend@gmail.com" });
  const first = await h.login("friend@gmail.com"), second = await h.login("friend@gmail.com");
  await h.call(owner, "/api/admin/accounts", { action: "disable", email: first.email });
  for (const session of [first, second]) assert.equal((await h.call(session, "/api/trade-records")).status, 401);
  await assert.rejects(h.login(first.email), { status: 403 });
  await h.call(owner, "/api/admin/accounts", { action: "enable", email: first.email });
  assert.equal((await h.call(first, "/api/trade-records")).status, 401);
  const restored = await h.login(first.email); assert.equal((await h.call(restored, "/api/trade-records")).status, 200);
  await h.call(owner, "/api/admin/accounts", { action: "revoke_sessions", email: first.email });
  assert.equal((await h.call(restored, "/api/auth/session")).status, 401);
  await h.call(owner, "/api/admin/accounts", { action: "invite", email: "pending@gmail.com" });
  await h.call(owner, "/api/admin/accounts", { action: "revoke_invite", email: "pending@gmail.com" });
  await assert.rejects(h.login("pending@gmail.com"), { status: 403 });
  const log = await h.call(owner, "/api/admin/events?q=friend"); assert.equal(log.body.events.length, 4);
});

test("manual/auto use atomic CAS and report the actual committed save mode", async t => {
  const h = setup(t), owner = await h.login(OWNER_EMAIL), first = await h.call(owner, "/api/trade-records");
  const write = { accountId: "primary", accountName: "Trader X2", dataset: { ...first.body.dataset, note: "changed" }, baseVersion: 37, saveMode: "manual" };
  assert.equal((await h.call(owner, "/api/trade-records", write, "PUT")).status, 200);
  assert.equal((await h.call(owner, "/api/trade-records", write, "PUT")).status, 409);
  write.baseVersion = 38; write.saveMode = "auto";
  assert.equal((await h.call(owner, "/api/trade-records", write, "PUT")).body.account.version, 39);
  assert.equal((await h.call(owner, "/api/admin/accounts")).body.accounts[0].saveMode, "auto");
});

test("session expiry, cookies, Origin and cross-tab session binding fail closed", async t => {
  const h = setup(t), owner = await h.login(OWNER_EMAIL);
  const req = h.request(owner, "/api/admin/accounts", { action: "invite", email: "friend@gmail.com" }); req.headers.set("Origin", "https://evil.example");
  assert.equal((await h.api.handle(req)).status, 403);
  const swapped = h.request(owner, "/api/trade-records"); swapped.headers.set("x-workspace-session", "old-session"); assert.equal((await h.api.handle(swapped)).status, 401);
  const hash = h.sqlite.prepare("SELECT token_hash FROM auth_sessions").get().token_hash;
  assert.notEqual(hash, owner.token); assert.equal(hash, await sha256(owner.token));
  const cookie = sessionCookie(owner.token, h.request(owner, "/")); for (const text of ["HttpOnly", "Secure", "SameSite=Lax", "Max-Age=2592000"]) assert.ok(cookie.includes(text));
  h.sqlite.prepare("UPDATE auth_sessions SET expires_at = ?").run("2000-01-01");
  await assert.rejects(requireSession(h.db, h.request(owner, "/")), { status: 401 });
});

test("Google JWT signature, claims and CSRF are verified before creating a session", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256"), jwk = await exportJWK(publicKey), keys = createLocalJWKSet({ keys: [{ ...jwk, alg: "RS256" }] });
  const token = overrides => new SignJWT({ sub: "google-sub", email: OWNER_EMAIL, email_verified: true, ...overrides }).setProtectedHeader({ alg: "RS256" }).setIssuer("https://accounts.google.com").setAudience("client").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  assert.equal((await verifyGoogleCredential(await token({}), "client", keys)).sub, "google-sub");
  await assert.rejects(verifyGoogleCredential(await token({}), "other-client", keys));
  await assert.rejects(verifyGoogleCredential(await token({ email_verified: false }), "client", keys));
  const expired = await new SignJWT({ sub: "x", email: OWNER_EMAIL, email_verified: true }).setProtectedHeader({ alg: "RS256" }).setIssuer("bad").setAudience("client").setIssuedAt().setExpirationTime(1).sign(privateKey);
  await assert.rejects(verifyGoogleCredential(expired, "client", keys));
  const other = await generateKeyPair("RS256"); await assert.rejects(verifyGoogleCredential(await token({}), "client", createLocalJWKSet({ keys: [await exportJWK(other.publicKey)] })));
  const req = new Request("https://app.example", { headers: { Cookie: "g_csrf_token=one" } });
  verifyGoogleCsrf(req, new URLSearchParams("g_csrf_token=one"));
  assert.throws(() => verifyGoogleCsrf(req, new URLSearchParams("g_csrf_token=two")), { status: 403 });
});

test("large R2 JSON commits by pointer, survives reload and detects tampering", async t => {
  const blobs = new Map();
  const objects = { async put(key, text, options) { blobs.set(key, { text, ...options }); }, async get(key) { const object = blobs.get(key); return object && { text: async () => object.text, customMetadata: object.customMetadata }; } };
  const h = setup(t, { objects }), owner = await h.login(OWNER_EMAIL);
  await h.call(owner, "/api/trade-records");
  const dataset = { ...h.original, evidence: "x".repeat(2_100_000) };
  const result = await h.call(owner, "/api/trade-records", { accountId: "primary", accountName: "Trader", dataset, baseVersion: 37 }, "PUT");
  assert.equal(result.status, 200); assert.equal(result.body.account.version, 38);
  assert.deepEqual((await h.call(owner, "/api/trade-records")).body.dataset, dataset);
  const row = h.sqlite.prepare("SELECT * FROM trade_account_snapshots").get(); assert.equal(row.dataset_json, "{}"); assert.ok(row.object_key.startsWith(`snapshots/${owner.userId}/`));
  objects.put = async () => { throw new Error("R2 unavailable"); };
  const failed = await h.call(owner, "/api/trade-records", { accountName: "Trader", dataset, baseVersion: 38 }, "PUT"); assert.equal(failed.status, 500);
  assert.equal(h.sqlite.prepare("SELECT version FROM trade_account_snapshots").get().version, 38);
  blobs.get(row.object_key).text = "{}"; assert.equal((await h.call(owner, "/api/trade-records")).status, 503);
});

test("local file migration preserves full JSON and original version in an isolated directory", async t => {
  const dir = await mkdtemp(join(tmpdir(), "tg-accounts-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const files = createLocalRecordStore(dir), h = setup(t, { files });
  h.sqlite.prepare("DELETE FROM trade_account_snapshots").run();
  await files.save({ accountId: "primary", accountName: "Trader", dataset: h.original, baseVersion: 0 }, { initialVersion: 37 });
  const owner = await h.login(OWNER_EMAIL); const result = await h.call(owner, "/api/trade-records");
  assert.equal(result.body.account.version, 37); assert.deepEqual(result.body.dataset, h.original);
  assert.equal((await files.list()).length, 1);
  assert.equal((await h.call(owner, "/api/trade-records", { accountName: "Trader", dataset: h.original, baseVersion: 37, saveMode: "auto" }, "PUT")).status, 200);
  assert.equal((await h.call(owner, "/api/admin/accounts")).body.accounts[0].saveMode, "auto");
});

test("session cancellation drops late responses and journals never cross user namespaces", async () => {
  let resolve;
  const scope = createSessionScope("session-a", () => new Promise(done => { resolve = done; }));
  const request = scope.fetch("/api/trade-records"); scope.stop(); resolve(new Response("{}"));
  await assert.rejects(request, { status: 401 }); await assert.rejects(scope.fetch("/api/trade-records"), { status: 401 });
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }, dataset = emptyDataset();
  writeLocalRecord(storage, "records.user.a", "primary", JSON.stringify({ ...dataset, note: "a private draft" }), JSON.stringify(dataset), 1);
  assert.deepEqual(readPendingRecord(storage, "records.user.b", "primary", dataset).dataset, dataset);
  assert.equal(readPendingRecord(storage, "records.user.a", "primary", dataset).dataset.note, "a private draft");
});

test('history captures upgrade baseline atomically; restore creates a new version and checks CAS', async t => {
  const h=setup(t), owner=await h.login(OWNER_EMAIL);
  const before=await h.call(owner,'/api/trade-records');
  const edited={...before.body.dataset,profile:{...before.body.dataset.profile,name:'edited'}};
  const saved=await h.call(owner,'/api/trade-records',{accountId:'primary',accountName:'edited',dataset:edited,baseVersion:37},'PUT');
  assert.equal(saved.status,200);
  const list=await h.call(owner,'/api/admin/history');assert.equal(list.status,200);
  assert.deepEqual(list.body.items.map(r=>r.version),[38,37]);
  const baseline=list.body.items.find(r=>r.version===37);assert.equal(baseline.pinned,1);
  const conflict=await h.call(owner,'/api/admin/history?action=restore',{id:baseline.id,baseVersion:37});assert.equal(conflict.status,409);
  const restored=await h.call(owner,'/api/admin/history?action=restore',{id:baseline.id,baseVersion:38});assert.equal(restored.status,200);assert.equal(restored.body.account.version,39);
  const current=await h.call(owner,'/api/trade-records');assert.deepEqual(current.body.dataset,before.body.dataset);
  await h.call(owner,'/api/admin/accounts',{action:'invite',email:'history-test@gmail.com'});
  const visitor=await h.login('history-test@gmail.com');
  assert.equal((await h.call(visitor,'/api/admin/history')).status,403);
  assert.equal((await h.call(visitor,'/api/admin/history?action=restore',{id:baseline.id,baseVersion:39})).status,403);
});

test('history cleanup retains current, pinned, recent and daily representatives; rechecks after preview', async t => {
  const h=setup(t), owner=await h.login(OWNER_EMAIL);
  await h.call(owner,'/api/trade-records');
  const user=h.sqlite.prepare('SELECT id FROM app_users WHERE email=?').get(OWNER_EMAIL);
  const day=days=>new Date(Date.now()-days*86400000).toISOString().slice(0,10);
  const insert=(version,date,pinned=0,key=null)=>h.sqlite.prepare(`INSERT INTO snapshot_history(owner_user_id,account_id,account_name,version,created_at,dataset_json,object_key,size_bytes,pinned) VALUES(?,'primary','test',?,?,'{}',?,10,?)`).run(user.id,version,date,key,pinned);
  insert(1,`${day(40)}T00:00:00Z`,1);insert(2,`${day(40)}T01:00:00Z`);
  insert(3,`${day(10)}T01:00:00Z`);insert(4,`${day(10)}T02:00:00Z`);
  insert(5,`${day(2)}T01:00:00Z`);insert(37,`${day(40)}T03:00:00Z`);
  const preview=await h.call(owner,'/api/admin/history?action=preview');assert.equal(preview.status,200);
  assert.deepEqual(preview.body.items.map(r=>r.version),[2,3]);
  const ids=preview.body.items.map(r=>r.id);
  h.sqlite.prepare('UPDATE snapshot_history SET pinned=1 WHERE version=3').run();
  const result=await h.call(owner,'/api/admin/history?action=cleanup',{ids});assert.equal(result.status,200);assert.equal(result.body.removed,1);
  assert.deepEqual(h.sqlite.prepare('SELECT version FROM snapshot_history ORDER BY version').all().map(r=>r.version),[1,3,4,5,37]);
  const forged=await h.call(owner,'/api/admin/history?action=cleanup',{ids:h.sqlite.prepare('SELECT id FROM snapshot_history').all().map(r=>r.id)});assert.equal(forged.body.removed,0);
});

test('large history restore uses a fresh object and retains original; corrupt history cannot restore', async t => {
  const blobs=new Map();const objects={
    async put(key,text,options){blobs.set(key,{text,customMetadata:options.customMetadata});return{};},
    async get(key){const v=blobs.get(key);return v?{text:async()=>v.text,customMetadata:v.customMetadata}:null;},
    async delete(key){blobs.delete(key);}
  };
  const h=setup(t,{objects}),owner=await h.login(OWNER_EMAIL);await h.call(owner,'/api/trade-records');
  const large={...h.original,evidence:'x'.repeat(1_900_000)};
  assert.equal((await h.call(owner,'/api/trade-records',{accountId:'primary',accountName:'large',dataset:large,baseVersion:37},'PUT')).status,200);
  const key=h.sqlite.prepare('SELECT object_key FROM trade_account_snapshots').get().object_key;
  const row=h.sqlite.prepare('SELECT id FROM snapshot_history WHERE version=38').get();
  const result=await h.call(owner,'/api/admin/history?action=restore',{id:row.id,baseVersion:38});assert.equal(result.status,200);
  assert.notEqual(h.sqlite.prepare('SELECT object_key FROM trade_account_snapshots').get().object_key,key);assert.ok(blobs.has(key));
  blobs.get(key).text='corrupted';
  assert.equal((await h.call(owner,'/api/admin/history?action=restore',{id:row.id,baseVersion:39})).status,503);
  assert.equal(h.sqlite.prepare('SELECT version FROM trade_account_snapshots').get().version,39);
});


test('failed R2 cleanup retains history for a later retry', async t => {
  let failing=true; const deleted=[];
  const objects={async delete(key){if(failing) throw new Error('unavailable');deleted.push(key);}};
  const h=setup(t,{objects}), owner=await h.login(OWNER_EMAIL); await h.call(owner,'/api/trade-records');
  const user=h.sqlite.prepare('SELECT id FROM app_users WHERE email=?').get(OWNER_EMAIL);
  const row=h.sqlite.prepare(`INSERT INTO snapshot_history(owner_user_id,account_id,account_name,version,created_at,dataset_json,object_key,size_bytes,pinned)
    VALUES(?,'primary','test',2,'2020-01-01T00:00:00Z','{}','old-object',100,0) RETURNING id`).get(user.id);
  const first=await h.call(owner,'/api/admin/history?action=cleanup',{ids:[Number(row.id)]});
  assert.equal(first.status,200);assert.equal(first.body.removed,0);assert.equal(first.body.pendingObjects,1);
  assert.ok(h.sqlite.prepare('SELECT id FROM snapshot_history WHERE id=?').get(row.id));
  failing=false;
  const retry=await h.call(owner,'/api/admin/history?action=cleanup',{ids:[Number(row.id)]});
  assert.equal(retry.body.removed,1);assert.deepEqual(deleted,['old-object']);
});


test('Sites trial binds separately and cannot claim primary, bypass identity, or manage Google users', async t => {
  const h=setup(t), original=h.sqlite.prepare('SELECT * FROM trade_account_snapshots WHERE account_id=?').get('primary');
  const req=(path='/',body,session,subject='site-owner',email=OWNER_EMAIL)=>new Request(`https://app.example${path}`,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':subject,'oai-authenticated-user-email':email,Origin:'https://app.example','Content-Type':'application/json',...(session?{'x-workspace-session':session}:{})},...(body?{body:JSON.stringify(body)}:{})});
  await assert.rejects(requireSitesTrialUser(h.db,req('/api/trade-records')), {status:403});
  const user=await requireSitesTrialUser(h.db,req(),{bootstrap:true});
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM system_owner').get().n,0);
  const api=createAccountApi({db:h.db,clientId:'',trial:true,authenticate:(request,options)=>requireSitesTrialUser(h.db,request,options)});
  const current=await (await api.handle(req('/api/trade-records'))).json();
  assert.notEqual(current.account.id,'primary');assert.equal(current.dataset.fills.length,0);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM trade_account_snapshots WHERE account_id=?').get('primary'),original);
  assert.equal((await api.handle(req('/api/trade-records?accountId=primary'))).status,403);
  assert.equal((await api.handle(req('/api/admin/accounts'))).status,403);
  assert.equal((await api.handle(req('/api/trade-records',null,null,'intruder'))).status,403);
  assert.equal((await api.handle(new Request('https://app.example/api/trade-records'))).status,401);
  const save=req('/api/trade-records',{accountId:current.account.id,accountName:'trial',dataset:current.dataset,baseVersion:current.account.version},user.sessionId);
  const put=new Request(save,{method:'PUT'});assert.equal((await api.handle(put)).status,200);
  const cross=req('/api/auth/logout',{},user.sessionId);cross.headers.set('Origin','https://evil.example');assert.equal((await api.handle(cross)).status,403);
  assert.equal((await api.handle(req('/api/auth/logout',{},user.sessionId))).status,200);
  assert.equal((await api.handle(req('/api/trade-records',null,user.sessionId))).status,401);
  const google=await h.login(OWNER_EMAIL,'real-google-owner');
  const legacy=await h.call(google,'/api/trade-records');assert.equal(legacy.body.account.id,'primary');assert.deepEqual(legacy.body.dataset,h.original);
});


test("fresh login loads latest saved owned ledger, explicit selection stays scoped", async t => {
  const h=setup(t), owner=await h.login(OWNER_EMAIL);
  await h.call(owner,"/api/trade-records");
  const latest={...h.original,note:"latest saved evidence"};
  h.sqlite.prepare("INSERT INTO trade_account_snapshots(account_id,account_name,dataset_json,version,updated_at,owner_user_id) VALUES(?,?,?,?,?,?)").run("recent-ledger","最近保存",JSON.stringify(latest),8,"2099-01-01T00:00:00Z",owner.userId);
  const fresh=await h.login(OWNER_EMAIL);
  const restored=await h.call(fresh,"/api/trade-records");
  assert.equal(restored.body.account.id,"recent-ledger");
  assert.deepEqual(restored.body.dataset,latest);
  assert.equal((await h.call(fresh,"/api/trade-records?accountId=primary")).body.account.id,"primary");
  await h.call(owner,"/api/admin/accounts",{action:"invite",email:"isolated@gmail.com"});
  const other=await h.login("isolated@gmail.com");
  assert.equal((await h.call(other,"/api/trade-records?accountId=recent-ledger")).status,403);
  assert.notEqual((await h.call(other,"/api/trade-records")).body.account.id,"recent-ledger");
});

test('old clients cannot empty a populated ledger via background saves',async t=>{
 const h=setup(t),owner=await h.login(OWNER_EMAIL);
 await h.call(owner,'/api/trade-records');
 const populated={...h.original,fills:[{id:'preserved'}],cashActivities:[{id:'deposit'}]};
 h.sqlite.prepare('UPDATE trade_account_snapshots SET dataset_json=? WHERE account_id=?').run(JSON.stringify(populated),'primary');
 const result=await h.call(owner,'/api/trade-records',{accountId:'primary',accountName:'Trader',dataset:h.original,baseVersion:37,saveMode:'auto'},'PUT');
 assert.equal(result.status,409);
 const after=await h.call(owner,'/api/trade-records');
 assert.equal(after.body.account.version,37);assert.deepEqual(after.body.dataset,populated);
});

test('local ledger recycle preserves file data and blocks stale writes across delete and restore', async t => {
  const dir=await mkdtemp(join(tmpdir(),'tg-recycle-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const files=createLocalRecordStore(dir),h=setup(t,{files});h.sqlite.prepare('DELETE FROM trade_account_snapshots').run();
  await files.save({accountId:'primary',accountName:'Local acceptance',dataset:h.original,baseVersion:0},{initialVersion:37});
  const owner=await h.login(OWNER_EMAIL),loaded=await h.call(owner,'/api/trade-records');assert.equal(loaded.body.account.version,37);
  const trashed=await h.call(owner,'/api/ledgers',{action:'trash',id:'primary',baseVersion:37});assert.equal(trashed.status,200);
  assert.equal((await h.call(owner,'/api/trade-records')).body.account,null);
  assert.equal((await h.call(owner,'/api/trade-records',{accountId:'primary',accountName:'stale',dataset:h.original,baseVersion:37},'PUT')).status,410);
  assert.deepEqual((await files.read('primary')).dataset,h.original);
  const restored=await h.call(owner,'/api/ledgers',{action:'restore',id:'primary',baseVersion:trashed.body.account.version});assert.equal(restored.status,200);
  const again=await h.call(owner,'/api/trade-records');assert.deepEqual(again.body.dataset,h.original);assert.equal(again.body.account.version,39);
  const edited={...h.original,profile:{...h.original.profile,name:'new edit'}};
  const saved=await h.call(owner,'/api/trade-records',{accountId:'primary',accountName:'Local acceptance',dataset:edited,baseVersion:39},'PUT');assert.equal(saved.status,200);assert.equal(saved.body.account.version,40);
  assert.deepEqual((await files.read('primary')).dataset,edited);
});

test('daily policy preview is non-destructive; enabled cleanup preserves current and restore advances version',async t=>{
 const h=setup(t,{retentionEnabled:true}),owner=await h.login(OWNER_EMAIL);
 const before=await h.call(owner,'/api/trade-records');
 const payload={accountId:'primary',accountName:'daily',dataset:before.body.dataset,baseVersion:37};
 assert.equal((await h.call(owner,'/api/trade-records',payload,'PUT')).status,200);
 const list=await h.call(owner,'/api/admin/history');assert.equal(list.body.retentionEnabled,true);
 const baseline=list.body.items.find(r=>r.version===37);
 const restored=await h.call(owner,'/api/admin/history?action=restore',{id:baseline.id,baseVersion:38});assert.equal(restored.body.account.version,39);
 const preview=await h.call(owner,'/api/admin/history?action=retention-preview');assert.equal(preview.body.removable,2);assert.equal(preview.body.retained,1);
 assert.equal(h.sqlite.prepare('SELECT count(*) n FROM snapshot_history').get().n,3);
 const clean=await h.call(owner,'/api/admin/history?action=cleanup',{ids:h.sqlite.prepare('SELECT id FROM snapshot_history').all().map(r=>r.id)});assert.equal(clean.body.removed,2);
 assert.deepEqual(h.sqlite.prepare('SELECT version FROM snapshot_history').all().map(r=>r.version),[39]);
 const after=await h.call(owner,'/api/trade-records');assert.deepEqual(after.body.dataset,before.body.dataset);
 assert.equal((await h.call(owner,'/api/trade-records',{...payload,baseVersion:38},'PUT')).status,409);
});
