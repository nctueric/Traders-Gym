import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { sqliteAdapter } from '../server/sqlite-adapter.mjs';
import { createAccountApi } from '../lib/account-api.mjs';
import { createMixedAuthenticator } from '../lib/mixed-auth.mjs';
import { createPasswordAuth, hashPassword } from '../lib/password-auth.mjs';
import { OWNER_EMAIL, emptyDataset, signIn } from '../lib/auth-core.mjs';
const password = 'only-an-isolated-test-password', passwordHash = await hashPassword(password);
const reason = '我希望完整記錄每次交易決策，透過定期複盤改善自己的進場與出場流程。';
function setup(t, options = {}) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close()); sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = new URL('../drizzle/', import.meta.url); for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(f, dir), 'utf8'));
  const db = sqliteAdapter(sqlite), pwd = createPasswordAuth({ db, email: OWNER_EMAIL, passwordHash }), authenticate = createMixedAuthenticator(db, pwd);
  const api = createAccountApi({ db, clientId: 'test-client', authenticate, verifyCredential: async value => JSON.parse(value), accessOptions: { password: pwd, ownerEmail: OWNER_EMAIL, applicationsOpen: true, ...options } });
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
  return { sqlite, db, api, req, call, google, sessionFrom, applicant, owner, link, submit, review, authenticate };
}

test('owner Google login cannot bootstrap a second user; binding preserves ledger identity and both login methods', async t => {
  const h = setup(t), owner = await h.owner();
  const dataset = { ...emptyDataset(), fills: [{ id: 'original-trade' }], proof: 'immutable snapshot' };
  h.sqlite.prepare('INSERT INTO trade_account_snapshots(account_id,account_name,dataset_json,version,updated_at,owner_user_id) VALUES(?,?,?,?,?,?)').run('original-ledger', '原帳本', JSON.stringify(dataset), 398, '2026-09-25', owner.userId);
  const before = h.sqlite.prepare('SELECT * FROM trade_account_snapshots').get();
  const direct = await h.google('owner-google', OWNER_EMAIL); assert.match(direct.headers.get('location'), /link_required/);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM app_users').get().n, 1);
  assert.equal((await h.link(owner)).status, 200);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM trade_account_snapshots').get(), before);
  const googleSession = h.sessionFrom(await h.google('owner-google', OWNER_EMAIL));
  const who = await h.call('/api/auth/session', googleSession); assert.equal(who.data.user.id, owner.userId); assert.equal(who.data.user.isOwner, true);
  for (const session of [owner, googleSession, await h.owner()]) {
    const read = await h.call('/api/trade-records', session); assert.equal(read.data.account.id, 'original-ledger'); assert.equal(read.data.account.version, 398); assert.deepEqual(read.data.dataset, dataset);
  }
});

test('applicants have separate sessions, no account or ledger and no full API access', async t => {
  const h = setup(t), owner = await h.owner(); await h.link(owner); const applicant = await h.applicant();
  for (const path of ['/api/auth/session', '/api/trade-records', '/api/admin/accounts', '/api/admin/applications', '/api/auth/google-link']) assert.equal((await h.call(path, applicant)).status, 401);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM app_users').get().n, 1);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM trade_account_snapshots').get().n, 0);
  const result = await h.submit(applicant); assert.equal(result.status, 200); assert.equal(result.data.application.status, 'PENDING');
  const another = await h.applicant('other', 'other@gmail.com'); assert.equal((await h.call('/api/auth/application', another)).data.application, null);
});

test('application version CAS preserves history and rejects stale review and duplicate submissions', async t => {
  const h = setup(t), owner = await h.owner(); await h.link(owner); const applicant = await h.applicant();
  const first = (await h.submit(applicant)).data.application;
  assert.equal((await h.submit(applicant, 0)).status, 409);
  const edited = (await h.submit(applicant, first.revision, reason + ' 每週回顧一次。')).data.application;
  assert.equal((await h.review(owner, first)).status, 409);
  assert.equal((await h.review(owner, edited)).status, 200);
  assert.equal((await h.review(owner, edited)).status, 409);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM account_invites').get().n, 1);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM access_application_history').get().n, 3);
  const details = await h.call(`/api/admin/applications?id=${first.id}`, owner); assert.equal(details.data.history.length, 3);
});

test('approval binds Google subject; entering creates just one private ledger and consumes limited session', async t => {
  const h = setup(t), owner = await h.owner(); await h.link(owner); const applicant = await h.applicant();
  const application = (await h.submit(applicant)).data.application; await h.review(owner, application);
  const wrong = await h.applicant('wrong-sub', 'applicant@gmail.com'); assert.equal((await h.call('/api/auth/application', wrong)).data.access, 'CONFLICT');
  const enter = await h.call('/api/auth/application', applicant, { action: 'enter' }); assert.equal(enter.status, 200); assert.equal(enter.response.headers.getSetCookie().length, 2);
  const full = h.sessionFrom(enter.response); const record = await h.call('/api/trade-records', full); assert.deepEqual(record.data.dataset, emptyDataset());
  assert.equal((await h.call('/api/auth/application', applicant)).status, 401);
  assert.equal((await h.call('/api/admin/applications', full)).status, 403);
  await h.call('/api/trade-records', full); assert.equal(h.sqlite.prepare('SELECT count(*) n FROM trade_account_snapshots').get().n, 1);
});

test('revoked invitation and disabled account override approval and cannot be repaired by applying again', async t => {
  const h = setup(t), owner = await h.owner(); await h.link(owner); const applicant = await h.applicant();
  await h.review(owner, (await h.submit(applicant)).data.application);
  await h.call('/api/admin/accounts', owner, { action: 'revoke_invite', email: 'applicant@gmail.com' });
  assert.equal((await h.call('/api/auth/application', applicant)).data.access, 'REVOKED');
  assert.equal((await h.call('/api/auth/application', applicant, { action: 'enter' })).status, 403);
  assert.equal((await h.submit(applicant, 2)).status, 403);
  await h.call('/api/admin/accounts', owner, { action: 'invite', email: 'applicant@gmail.com' });
  const full = h.sessionFrom(await h.google()); await h.call('/api/admin/accounts', owner, { action: 'disable', email: 'applicant@gmail.com' });
  assert.equal((await h.call('/api/trade-records', full)).status, 401);
  const disabled = await h.applicant(); assert.equal((await h.call('/api/auth/application', disabled)).data.access, 'DISABLED'); assert.equal((await h.submit(disabled)).status, 403);
});

test('rejection requires explanation; resubmission retains previous reason and reviewed version', async t => {
  const h = setup(t), owner = await h.owner(); await h.link(owner); const applicant = await h.applicant(), first = (await h.submit(applicant)).data.application;
  assert.equal((await h.review(owner, first, 'REJECTED')).status, 400);
  await h.review(owner, first, 'REJECTED', '請補充預計的複盤方式');
  assert.equal((await h.call('/api/auth/application', applicant)).data.application.reviewNote, '請補充預計的複盤方式');
  const newApplication = await h.submit(applicant, 2, reason + ' 會用每週摘要作為回顧。'); assert.equal(newApplication.data.application.revision, 3);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM access_applications').get().n, 1);
  assert.equal(h.sqlite.prepare("SELECT note FROM access_application_history WHERE action='REJECTED'").get().note, '請補充預計的複盤方式');
});

test('failed invitation insert rolls back decision and history atomically', async t => {
  const h = setup(t), owner = await h.owner(); await h.link(owner); const applicant = await h.applicant(), first = (await h.submit(applicant)).data.application;
  h.sqlite.exec("CREATE TRIGGER fail_invite BEFORE INSERT ON account_invites BEGIN SELECT RAISE(ABORT, 'isolated write failure'); END;");
  assert.equal((await h.review(owner, first)).status, 500);
  assert.equal(h.sqlite.prepare('SELECT status FROM access_applications').get().status, 'PENDING'); assert.equal(h.sqlite.prepare('SELECT count(*) n FROM access_application_history').get().n, 1);
  h.sqlite.exec('DROP TRIGGER fail_invite'); assert.equal((await h.review(owner, first)).status, 200);
});

test('closed applications, missing owner binding, expiration and CSRF fail closed', async t => {
  const h = setup(t, { applicationsOpen: false }), owner = await h.owner(); await h.link(owner); const applicant = await h.applicant();
  assert.equal((await h.submit(applicant)).status, 403);
  const attack = h.req('/api/auth/application', applicant, { explanation: reason, revision: 0 }); attack.headers.set('Origin', 'https://other.example'); assert.equal((await h.api.handle(attack)).status, 403);
  const swapped = h.req('/api/auth/application', applicant, { explanation: reason, revision: 0 }); swapped.headers.set('x-application-session', 'another-tab'); assert.equal((await h.api.handle(swapped)).status, 403);
  h.sqlite.exec("UPDATE application_sessions SET expires_at='2000-01-01'"); assert.equal((await h.call('/api/auth/application', applicant)).status, 401);
  const g = setup(t), pending = await g.applicant(); assert.equal((await g.submit(pending)).status, 403);
});

test('link challenges enforce recent password, nonce, expiry, single use and identity conflicts', async t => {
  const h = setup(t), owner = await h.owner();
  assert.equal((await h.call('/api/auth/google-link?action=start', owner, { password: 'wrong' })).status, 400);
  const start = await h.call('/api/auth/google-link?action=start', owner, { password });
  const payload = { challenge: start.data.challenge, credential: JSON.stringify({ sub: 'owner-google', email: OWNER_EMAIL, nonce: 'wrong' }) };
  assert.equal((await h.call('/api/auth/google-link', owner, payload)).status, 403);
  h.sqlite.exec("UPDATE google_link_challenges SET expires_at='2000-01-01'"); assert.equal((await h.call('/api/auth/google-link', owner, payload)).status, 409);
  assert.equal((await h.link(owner)).status, 200); assert.equal((await h.call('/api/auth/google-link?action=start', owner, { password })).status, 409);
});

test('password session revocation never falls back to Google and invite-only legacy login still works', async t => {
  const h = setup(t), owner = await h.owner(); await h.link(owner);
  await h.call('/api/admin/accounts', owner, { action: 'invite', email: 'legacy@gmail.com' });
  const full = h.sessionFrom(await h.google('legacy', 'legacy@gmail.com')); assert.equal((await h.call('/api/auth/session', full)).status, 200);
  h.sqlite.exec('DELETE FROM password_session_credentials');
  assert.equal((await h.call('/api/auth/session', owner)).status, 401);
  assert.equal((await h.call('/api/admin/applications', owner)).status, 401);
  const actualGoogle = h.sessionFrom(await h.google('owner-google', OWNER_EMAIL)); assert.equal((await h.call('/api/admin/applications', actualGoogle)).status, 200);
});

test('review queue sorts oldest pending first, supports filtering and search; malicious text remains data', async t => {
  const h = setup(t), owner = await h.owner(); await h.link(owner); const a = await h.applicant(), b = await h.applicant('second', 'second@gmail.com');
  const first = (await h.submit(a, 0, reason + '<script>alert(1)</script>')).data.application; await h.submit(b);
  const list = await h.call('/api/admin/applications?status=PENDING&q=applicant', owner); assert.equal(list.data.pendingCount, 2); assert.equal(list.data.applications.length, 1); assert.equal(list.data.applications[0].id, first.id);
  assert.match(list.data.applications[0].explanation, /<script>/);
  assert.equal((await h.submit(a, first.revision, 'too short')).status, 400);
  assert.equal((await h.submit(a, first.revision, '長'.repeat(2001))).status, 400);
});

test('Google sign-in enforces a subject-bound invitation inside the transaction', async t => {
  const h = setup(t), owner = await h.owner(); await h.link(owner); const a = await h.applicant(); await h.review(owner, (await h.submit(a)).data.application);
  await assert.rejects(signIn(h.db, { sub: 'other', email: 'applicant@gmail.com' }), { status: 403 });
  assert.equal(h.sqlite.prepare("SELECT status FROM account_invites WHERE email='applicant@gmail.com'").get().status, 'PENDING');
});

test('unlinked password owner never claims unowned legacy ledger in mixed mode', async t => {
  const h = setup(t), owner = await h.owner();
  h.sqlite.prepare("INSERT INTO trade_account_snapshots(account_id,account_name,dataset_json,version,updated_at) VALUES('primary','legacy','{}',9,'2026-09-01')").run();
  const result = await h.call('/api/trade-records', owner); assert.notEqual(result.data.account.id, 'primary');
  assert.equal(h.sqlite.prepare("SELECT owner_user_id FROM trade_account_snapshots WHERE account_id='primary'").get().owner_user_id, null);
  await assert.rejects(signIn(h.db, { sub: 'new-google', email: OWNER_EMAIL }), { status: 403 });
});

test('simultaneous application decisions commit exactly one audit event', async t => {
  const h = setup(t), owner = await h.owner(); await h.link(owner); const applicant = await h.applicant(), first = (await h.submit(applicant)).data.application;
  const results = await Promise.all([h.review(owner, first), h.review(owner, first, 'REJECTED', '需補充資料')]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM access_application_history').get().n, 2);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM account_admin_events').get().n, 1);
});

test('application writes are rate limited and Google linking cannot take another user identity', async t => {
  const h = setup(t), owner = await h.owner(); await h.link(owner); const applicant = await h.applicant();
  for (let revision = 0; revision < 10; revision++) assert.equal((await h.submit(applicant, revision, reason + revision)).status, 200);
  assert.equal((await h.submit(applicant, 10)).status, 429);
  const other = setup(t), current = await other.owner();
  other.sqlite.prepare("INSERT INTO app_users(id,google_sub,email,name,status,created_at,last_login_at) VALUES('already','owner-google','different@gmail.com','other','ACTIVE','2026-01-01','2026-01-01')").run();
  assert.equal((await other.link(current)).status, 409);
  assert.match(other.sqlite.prepare('SELECT google_sub FROM app_users WHERE id=?').get(current.userId).google_sub, /^personal-password:/);
  assert.equal(other.sqlite.prepare('SELECT count(*) n FROM system_owner').get().n, 0);
});


test('temporary open Google access admits new identities but preserves revocation, ownership and admin-only ledger metadata', async t => {
  const h = setup(t, { openGoogleLogin: true }), owner = await h.owner(); await h.link(owner);
  const response = await h.google('open-member', 'open@example.org');
  assert.equal(response.headers.get('location'), '/');
  const member = h.sessionFrom(response);
  const who = await h.call('/api/auth/session', member);
  assert.equal(who.status, 200); assert.equal(who.data.user.isOwner, false);
  const first = await h.call('/api/trade-records', member); assert.equal(first.status, 200);
  member.id = who.data.user.sessionId;
  const second = await h.call('/api/ledgers', member, { action: 'create', name: 'Second' }); assert.equal(second.status, 201);
  const list = await h.call('/api/admin/accounts', owner);
  const rows = list.data.accounts.filter(row => row.email === 'open@example.org');
  assert.equal(rows.length, 1); assert.equal(rows[0].ledgerCount, 2); assert.equal(rows[0].ledgers.length, 2);
  assert.ok(rows[0].activeSessions >= 1); assert.ok(rows[0].lastLoginAt);
  assert.equal((await h.call('/api/admin/accounts', member)).status, 403);
  h.sqlite.prepare("UPDATE app_users SET status='DISABLED' WHERE google_sub='open-member'").run();
  assert.notEqual((await h.google('open-member', 'open@example.org')).headers.get('location'), '/');
  h.sqlite.prepare("INSERT INTO account_invites(email,status,created_by,created_at) VALUES('revoked@example.org','REVOKED',?,'2026-01-01')").run(owner.userId);
  assert.notEqual((await h.google('revoked-member','revoked@example.org')).headers.get('location'), '/');
  assert.equal(h.sqlite.prepare("SELECT count(*) n FROM app_users WHERE email='revoked@example.org'").get().n, 0);
  assert.equal((await h.google('different-sub','open@example.org')).headers.get('location'), '/apply');
});

test('closing open Google access blocks new enrollment without disabling existing members', async t => {
  const h = setup(t), owner = await h.owner(); await h.link(owner);
  assert.equal((await h.google('not-invited','new@example.org')).headers.get('location'), '/apply');
  const open = createAccountApi({ db: h.db, clientId: 'test-client', authenticate: h.authenticate, verifyCredential: async value => JSON.parse(value), accessOptions: { ownerEmail: OWNER_EMAIL, openGoogleLogin: true } });
  const request = new Request('https://test.example/api/auth/google', { method:'POST', headers:{Cookie:'g_csrf_token=test','Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({g_csrf_token:'test',credential:JSON.stringify({sub:'enrolled',email:'enrolled@example.org',email_verified:true})}) });
  assert.equal((await open.handle(request)).headers.get('location'), '/');
  assert.equal((await h.google('enrolled','enrolled@example.org')).headers.get('location'), '/');
});
