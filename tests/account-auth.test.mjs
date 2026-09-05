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
