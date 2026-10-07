import {memoryObjects} from './cloud-objects.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { sqliteAdapter } from '../server/sqlite-adapter.mjs';
import { createAccountApi } from '../lib/account-api.mjs';
import { createMixedAuthenticator } from '../lib/mixed-auth.mjs';
import { createPasswordAuth, hashPassword } from '../lib/password-auth.mjs';
import { OWNER_EMAIL, emptyDataset } from '../lib/auth-core.mjs';
const password = 'only-an-isolated-test-password', passwordHash = await hashPassword(password);
const reason = '我希望完整記錄每次交易決策，透過定期複盤改善自己的進場與出場流程。';
function setup(t, options = {}) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close()); sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = new URL('../drizzle/', import.meta.url); for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(f, dir), 'utf8'));
  const outbox=[]; const db = sqliteAdapter(sqlite), pwd = createPasswordAuth({ db, email: OWNER_EMAIL, passwordHash }), authenticate = createMixedAuthenticator(db, pwd);
  const api = createAccountApi({ objects:memoryObjects(),db, clientId: 'test-client', authenticate, verifyCredential: async value => JSON.parse(value), accessOptions: { password: pwd, ownerEmail: OWNER_EMAIL, applicationsOpen: true, sendMail:async message=>outbox.push(message), ...options } });
  const req = (path, session = {}, body) => new Request(`https://test.example${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: 'https://test.example', 'Content-Type': 'application/json', Cookie: session.cookie || '', 'x-workspace-session': session.id || '', 'x-application-session': session.id || '' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const call = async (path, session, body) => { const response = await api.handle(req(path, session, body)); return { status: response.status, data: await response.json(), response }; };
  const google = async (sub = 'applicant', email = 'applicant@gmail.com') => api.handle(new Request('https://test.example/api/auth/google', { method: 'POST', headers: { Cookie: 'g_csrf_token=test', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ g_csrf_token: 'test', credential: JSON.stringify({ sub, email, name: '測試申請人', email_verified: true }) }) }));
  const sessionFrom = response => ({ cookie: response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') });
  const applicant = async (sub, email) => { const response = await google(sub, email), session = sessionFrom(response); const state = await call('/api/auth/application', session); session.id = state.data.sessionId; return session; };
  const owner = async () => {
    const response = await pwd.login(req('/api/auth/password', {}, { email: OWNER_EMAIL, password })), session = sessionFrom(response);
    const who = await authenticate(req('/api/auth/session', session)); session.id = who.sessionId; session.userId = who.id; return session;
  };
  const link = async session => { const start = await call('/api/auth/google-link?action=start', session, { password }); assert.equal(start.status, 200); return call('/api/auth/google-link', session, { challenge: start.data.challenge, credential: JSON.stringify({ sub: 'owner-google', email: OWNER_EMAIL, name: 'Owner', nonce: start.data.challenge }) }); };
  const submit = async (session, revision = 0, explanation = reason) => call('/api/auth/application', session, { explanation, revision });
  const review = async (session, app, decision = 'APPROVED', note = '') => call('/api/admin/applications', session, { id: app.id, revision: app.revision, decision, note });
  return { outbox, sqlite, db, api, req, call, google, sessionFrom, applicant, owner, link, submit, review, authenticate };
}

const memberPassword='my-isolated-member-password';
const mailToken=h=>new URLSearchParams(new URL(h.outbox.at(-1).url).hash.slice(1)).get('token');
async function emailApplicant(h,email='member@example.com'){
 assert.equal((await h.call('/api/auth/email',{}, {action:'request',purpose:'apply',name:'Member',email})).status,200);
 const verified=await h.call('/api/auth/email',{}, {action:'consume',token:mailToken(h)});assert.equal(verified.status,200,JSON.stringify(verified.data));
 const session=h.sessionFrom(verified.response);session.id=(await h.call('/api/auth/application',session)).data.sessionId;return session;
}
async function emailMember(h){const owner=await h.owner();await h.link(owner);const pending=await emailApplicant(h);const app=(await h.submit(pending)).data.application;assert.ok(app);assert.equal((await h.review(owner,app)).status,200);assert.equal((await h.call('/api/auth/application',pending,{action:'enter'})).status,200);const token=mailToken(h);assert.equal((await h.call('/api/auth/email',{}, {action:'consume',token,password:memberPassword})).status,200);const login=await h.call('/api/auth/password',{}, {email:'member@example.com',password:memberPassword});assert.equal(login.status,200,JSON.stringify(login.data));const member=h.sessionFrom(login.response);member.id=(await h.call('/api/auth/session',member)).data.user.sessionId;return {owner,pending,member,token};}

test('Email verification is single use, approval is required, credentials keep member identity private',async t=>{
 const h=setup(t),{member,pending,token}=await emailMember(h);
 assert.equal((await h.call('/api/auth/email',{}, {action:'consume',token,password:memberPassword})).status,409);
 assert.equal((await h.call('/api/trade-records',pending)).status,401);
 assert.equal((await h.call('/api/ledgers',pending)).status,401);
 const records=await h.call('/api/trade-records',member);assert.equal(records.status,200);assert.equal(records.data.dataset.fills.length,0);
 assert.equal((await h.call('/api/admin/accounts',member)).status,403);
 const user=h.sqlite.prepare("SELECT * FROM app_users WHERE email='member@example.com'").get();assert.equal(user.google_sub,null);
 assert.ok(h.sqlite.prepare('SELECT password_hash FROM email_credentials WHERE user_id=?').get(user.id).password_hash.startsWith('pbkdf2'));
 assert.equal(h.sqlite.prepare('SELECT count(*) n FROM email_tokens WHERE token_hash=?').get(token).n,0);
});
test('password reset expires all sessions, rejects short passwords, replay, expired links and disabled accounts',async t=>{
 const h=setup(t),{member}=await emailMember(h);
 assert.equal((await h.call('/api/auth/password',{}, {email:'nobody@example.com',password:'wrong'})).status,401);
 assert.equal((await h.call('/api/auth/email',{}, {action:'request',purpose:'reset',email:'member@example.com'})).status,200);
 const token=mailToken(h);assert.equal((await h.call('/api/auth/email',{}, {action:'consume',token,password:'short'})).status,400);
 const changed=await h.call('/api/auth/email',{}, {action:'consume',token,password:memberPassword+'2'});assert.equal(changed.status,200);
 assert.equal((await h.call('/api/trade-records',member)).status,401);
 assert.equal((await h.call('/api/auth/password',{}, {email:'member@example.com',password:memberPassword})).status,401);
 h.sqlite.exec('DELETE FROM password_login_limits');await h.call('/api/auth/email',{}, {action:'request',purpose:'reset',email:'member@example.com'});const expired=mailToken(h);h.sqlite.exec("UPDATE email_tokens SET expires_at='2000-01-01'");assert.equal((await h.call('/api/auth/email',{}, {action:'consume',token:expired,password:memberPassword})).status,409);
 await h.call('/api/auth/email',{}, {action:'request',purpose:'reset',email:'member@example.com'});const disabled=mailToken(h);h.sqlite.exec("UPDATE app_users SET status='DISABLED' WHERE email='member@example.com'");assert.equal((await h.call('/api/auth/email',{}, {action:'consume',token:disabled,password:memberPassword})).status,403);
});
test('mail sending failures invalidate token and preserve existing account; resend and CSRF limits apply',async t=>{
 const h=setup(t,{sendMail:async()=>{throw new Error('offline');}});
 assert.equal((await h.call('/api/auth/email',{}, {action:'request',purpose:'apply',name:'Test',email:'test@example.com'})).status,500);
 assert.equal(h.sqlite.prepare('SELECT count(*) n FROM email_tokens').get().n,0);
 for(let i=0;i<2;i++)await h.call('/api/auth/email',{}, {action:'request',purpose:'apply',name:'Test',email:'test@example.com'});
 assert.equal((await h.call('/api/auth/email',{}, {action:'request',purpose:'apply',name:'Test',email:'test@example.com'})).status,429);
 const req=h.req('/api/auth/email',{}, {action:'request',purpose:'reset',email:'test@example.com'});req.headers.set('Origin','https://evil.example');assert.equal((await h.api.handle(req)).status,403);
});
test('Email member can link Google after password reauthentication, same identity and original ledger retained',async t=>{
 const h=setup(t),{member}=await emailMember(h);const before=await h.call('/api/trade-records',member);
 const start=await h.call('/api/auth/google-link?action=start',member,{password:memberPassword});assert.equal(start.status,200,JSON.stringify(start.data));
 const linked=await h.call('/api/auth/google-link',member,{challenge:start.data.challenge,credential:JSON.stringify({sub:'member-google',email:'member@example.com',nonce:start.data.challenge})});assert.equal(linked.status,200,JSON.stringify(linked.data));
 const google=h.sessionFrom(await h.google('member-google','member@example.com'));const after=await h.call('/api/trade-records',google);assert.equal(after.status,200);assert.equal(after.data.account.id,before.data.account.id);assert.deepEqual(after.data.dataset,before.data.dataset);
 assert.equal((await h.call('/api/admin/accounts',google)).status,403);
});
test('same email across Google and Mail cannot silently merge; approval revocation blocks activation',async t=>{
 const h=setup(t),owner=await h.owner();await h.link(owner);
 const pending=await emailApplicant(h);const app=(await h.submit(pending)).data.application;await h.review(owner,app);await h.call('/api/auth/application',pending,{action:'enter'});const token=mailToken(h);
 const conflicting=await h.applicant('different-google','member@example.com');assert.equal((await h.call('/api/auth/application',conflicting)).data.access,'CONFLICT');
 await h.call('/api/admin/accounts',owner,{action:'revoke_invite',email:'member@example.com'});
 assert.equal((await h.call('/api/auth/email',{}, {action:'consume',token,password:memberPassword})).status,409);
 assert.equal(h.sqlite.prepare("SELECT count(*) n FROM app_users WHERE email='member@example.com'").get().n,0);
});
test('member ledger lifecycle preserves snapshots, selection and deletion epochs across sessions',async t=>{
 const h=setup(t),{member,owner}=await emailMember(h);const initial=(await h.call('/api/trade-records',member)).data;
 const created=await h.call('/api/ledgers',member,{action:'create',name:'新策略帳本'});assert.equal(created.status,201);const ledger=created.data.account;
 assert.equal((await h.call('/api/trade-records',member)).data.account.id,ledger.id);
 assert.equal((await h.call(`/api/trade-records?accountId=${ledger.id}`,owner)).status,403);
 const renamed=await h.call('/api/ledgers',member,{action:'rename',id:ledger.id,name:'改名',baseVersion:ledger.version});assert.equal(renamed.status,200);
 assert.equal((await h.call('/api/ledgers',member,{action:'trash',id:ledger.id,baseVersion:ledger.version})).status,409);
 const removed=await h.call('/api/ledgers',member,{action:'trash',id:ledger.id,baseVersion:renamed.data.account.version});assert.equal(removed.status,200);
 const stale=h.req('/api/trade-records',member);const put=new Request(stale,{method:'PUT',body:JSON.stringify({accountId:ledger.id,accountName:'old',dataset:initial.dataset,baseVersion:renamed.data.account.version})});assert.equal((await h.api.handle(put)).status,410);
 assert.equal((await h.call('/api/trade-records',member)).data.account.id,initial.account.id);
 const restored=await h.call('/api/ledgers',member,{action:'restore',id:ledger.id,baseVersion:removed.data.account.version});assert.equal(restored.status,200);assert.equal(restored.data.account.name,'改名');
 assert.deepEqual((await h.call(`/api/trade-records?accountId=${ledger.id}`,member)).data.dataset,emptyDatasetWithName('新策略帳本'));
 for(const row of (await h.call('/api/ledgers',member)).data.accounts.filter(row=>!row.deletedAt))assert.equal((await h.call('/api/ledgers',member,{action:'trash',id:row.id,baseVersion:row.version})).status,200);
 assert.equal((await h.call('/api/trade-records',member)).data.account,null);
 assert.equal((await h.call('/api/trade-records',member)).data.account,null);
 assert.equal((await h.call('/api/ledgers',member)).data.accounts.length,2);
});
function emptyDatasetWithName(name){const data=emptyDataset();data.profile.name=name;return data;}
test('migration 0008 preserves populated Google identities, sessions, review history and ledger ownership',t=>{
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');const dir=new URL('../drizzle/',import.meta.url);for(const f of readdirSync(dir).filter(f=>f.endsWith('.sql')&&f<'0008').sort())sqlite.exec(readFileSync(new URL(f,dir),'utf8'));
 sqlite.exec("INSERT INTO app_users VALUES('old','google-old','old@example.com','Existing','','ACTIVE','2026-01-01','2026-01-01'); INSERT INTO system_owner VALUES(1,'old','google-old'); INSERT INTO auth_sessions VALUES('session','hash','old','2026-01-01','2099-01-01','google'); INSERT INTO trade_account_snapshots(account_id,account_name,dataset_json,version,updated_at,owner_user_id) VALUES('ledger','Before','{\"proof\":true}',97,'2026-01-01','old'); INSERT INTO access_applications(id,google_sub,email,name,explanation,status,revision,submitted_at,updated_at,event_id) VALUES('apply','app-sub','app@example.com','Applicant','Original','PENDING',3,'2026-01-01','2026-01-01','event'); INSERT INTO access_application_history(id,application_id,revision,action,explanation,actor_id,created_at) VALUES('history','apply',3,'SUBMITTED','Original','actor','2026-01-01');");
 const before=sqlite.prepare('SELECT * FROM trade_account_snapshots').get();sqlite.exec('BEGIN IMMEDIATE');sqlite.exec(readFileSync(new URL('0008_member_workflow.sql',dir),'utf8'));sqlite.exec('COMMIT');
 assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_sessions').get().n,1);assert.equal(sqlite.prepare('SELECT explanation FROM access_application_history').get().explanation,'Original');assert.equal(sqlite.prepare('SELECT identity_key FROM access_applications').get().identity_key,'google:app-sub');const after=sqlite.prepare('SELECT * FROM trade_account_snapshots').get();delete after.deleted_at;assert.deepEqual(after,before);
});
test('concurrent reset links consume once and failed transaction keeps token reusable',async t=>{
 const h=setup(t);await emailMember(h);await h.call('/api/auth/email',{}, {action:'request',purpose:'reset',email:'member@example.com'});const token=mailToken(h);
 h.sqlite.exec("CREATE TRIGGER fail_credential BEFORE UPDATE ON email_credentials BEGIN SELECT RAISE(ABORT,'test write failure'); END");assert.equal((await h.call('/api/auth/email',{}, {action:'consume',token,password:memberPassword+'next'})).status,500);assert.equal(h.sqlite.prepare("SELECT count(*) n FROM email_tokens WHERE purpose='reset' AND consumed_at IS NULL").get().n,1);h.sqlite.exec('DROP TRIGGER fail_credential');
 const responses=await Promise.all([h.call('/api/auth/email',{}, {action:'consume',token,password:memberPassword+'one'}),h.call('/api/auth/email',{}, {action:'consume',token,password:memberPassword+'two'})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
});
test('Google owner adds Mail without replacing owner identity and previous legacy password stops working',async t=>{
 const h=setup(t),owner=await h.owner();await h.link(owner);const original=(await h.call('/api/trade-records',owner)).data;
 const google=h.sessionFrom(await h.google('owner-google',OWNER_EMAIL));google.id=(await h.call('/api/auth/session',google)).data.user.sessionId;
 assert.equal((await h.call('/api/auth/email',google,{action:'request',purpose:'setup',email:OWNER_EMAIL})).status,200);const token=mailToken(h);
 assert.equal((await h.call('/api/auth/email',{}, {action:'consume',token,password:memberPassword})).status,200);assert.equal((await h.call('/api/trade-records',owner)).status,401);assert.equal((await h.call('/api/trade-records',google)).status,401);
 assert.equal((await h.call('/api/auth/password',{}, {email:OWNER_EMAIL,password})).status,401);
 const mail=h.sessionFrom((await h.call('/api/auth/password',{}, {email:OWNER_EMAIL,password:memberPassword})).response);const who=(await h.call('/api/auth/session',mail)).data.user;assert.equal(who.id,owner.userId);assert.equal(who.isOwner,true);assert.equal((await h.call('/api/trade-records',mail)).data.account.id,original.account.id);
});
