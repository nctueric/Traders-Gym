import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { sqliteAdapter } from '../server/sqlite-adapter.mjs';
import { createPasswordAuth, hashPassword, verifyPassword } from '../lib/password-auth.mjs';
import { createAccountApi } from '../lib/account-api.mjs';
import { emptyDataset } from '../lib/auth-core.mjs';

const email = 'tester@example.com', password = 'synthetic-test-password-only';
const passwordHash = await hashPassword(password);
function setup(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close()); sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = new URL('../drizzle/', import.meta.url);
  for (const name of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(name, dir), 'utf8'));
  const db = sqliteAdapter(sqlite), auth = createPasswordAuth({ db, email, passwordHash });
  const blobs = new Map(), objects = {
    async put(key, value, options) { blobs.set(key, { value, metadata: options.customMetadata }); return {}; },
    async get(key) { const o = blobs.get(key); return o ? { text: async () => o.value, customMetadata: o.metadata } : null; },
    async delete(key) { blobs.delete(key); },
  };
  const api = createAccountApi({ db, objects, clientId: '', trial: true, authenticate: auth.authenticate });
  const request = (path, method = 'GET', body, session = {}) => new Request(`https://trial.example${path}`, { method,
    headers: { Origin: 'https://trial.example', 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.1',
      ...(session.cookie ? { Cookie: session.cookie } : {}), ...(session.id ? { 'x-workspace-session': session.id } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const login = async () => {
    const response = await auth.login(request('/api/auth/password', 'POST', { email, password })); assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /Max-Age=43200/);
    const user = await auth.authenticate(request('/api/auth/session', 'GET', undefined, { cookie }));
    return { cookie, id: user.sessionId, user };
  };
  return { sqlite, db, auth, api, request, login, blobs };
}

test('password login rejects bad credentials and CSRF, throttles repeated attempts', async t => {
  const h = setup(t);
  const csrf = h.request('/api/auth/password', 'POST', { email, password }); csrf.headers.set('Origin', 'https://other.example');
  assert.equal((await h.auth.login(csrf)).status, 403);
  for (let n = 0; n < 10; n++) assert.equal((await h.auth.login(h.request('/api/auth/password', 'POST', { email, password: 'wrong' }))).status, 401);
  const limited = await h.auth.login(h.request('/api/auth/password', 'POST', { email, password }));
  assert.equal(limited.status, 429); assert.ok(limited.headers.get('retry-after'));
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM auth_sessions').get().n, 0);
});

test('personal session isolates legacy data, saves D1/R2, restores history, and logs out', async t => {
  const h = setup(t);
  h.sqlite.prepare("INSERT INTO trade_account_snapshots(account_id,account_name,dataset_json,version,updated_at) VALUES('primary','legacy','{}',7,'2026-09-01')").run();
  assert.equal((await h.api.handle(h.request('/api/trade-records'))).status, 401);
  const s = await h.login(); assert.equal(s.user.authProvider, 'password');
  const current = await (await h.api.handle(h.request('/api/trade-records', 'GET', undefined, s))).json();
  assert.notEqual(current.account.id, 'primary');
  assert.equal(h.sqlite.prepare("SELECT owner_user_id FROM trade_account_snapshots WHERE account_id='primary'").get().owner_user_id, null);
  assert.equal((await h.api.handle(h.request('/api/admin/accounts', 'GET', undefined, s))).status, 403);
  assert.equal((await h.api.handle(h.request('/api/auth/google', 'POST', {}, s))).status, 403);
  const small = { ...emptyDataset(), note: 'test evidence' };
  let response = await h.api.handle(h.request('/api/trade-records', 'PUT', { accountId: current.account.id, accountName: 'test', dataset: small, baseVersion: 1 }, s));
  assert.equal(response.status, 200);
  const large = { ...small, evidence: 'X'.repeat(1900000) };
  response = await h.api.handle(h.request('/api/trade-records', 'PUT', { accountId: current.account.id, accountName: 'test', dataset: large, baseVersion: 2 }, s));
  assert.equal(response.status, 200); assert.equal(h.blobs.size, 2);
  const readback = await (await h.api.handle(h.request('/api/trade-records', 'GET', undefined, s))).json(); assert.deepEqual(readback.dataset, large);
  const history = await (await h.api.handle(h.request('/api/admin/history', 'GET', undefined, s))).json();
  const old = history.items.find(row => row.version === 2);
  assert.equal((await h.api.handle(h.request('/api/admin/history?action=restore', 'POST', { id: old.id, baseVersion: 3 }, s))).status, 200);
  const restored = await (await h.api.handle(h.request('/api/trade-records', 'GET', undefined, s))).json();
  assert.deepEqual(restored.dataset, small); assert.equal(restored.account.version, 4);
  const changed = createPasswordAuth({ db: h.db, email, passwordHash: await hashPassword('new-synthetic-password') });
  await assert.rejects(changed.authenticate(h.request('/api/auth/session', 'GET', undefined, s)), { status: 401 });
  assert.equal((await h.api.handle(h.request('/api/auth/logout', 'POST', {}, s))).status, 200);
  assert.equal((await h.api.handle(h.request('/api/trade-records', 'GET', undefined, s))).status, 401);
});

test('password mode fails closed on invalid setup, wrong account, stale sessions and oversized input', async t => {
  const h = setup(t);
  assert.equal((await createPasswordAuth({ db: h.db, email, passwordHash: '' }).login(h.request('/api/auth/password', 'POST', { email, password }))).status, 503);
  assert.equal((await h.auth.login(h.request('/api/auth/password', 'POST', { email: 'other@example.com', password }))).status, 401);
  assert.equal((await h.auth.login(h.request('/api/auth/password', 'POST', { email, password: 'x'.repeat(5000) }))).status, 413);
  const s = await h.login();
  h.sqlite.prepare("UPDATE auth_sessions SET expires_at='2000-01-01' WHERE id=?").run(s.id);
  await assert.rejects(h.auth.authenticate(h.request('/api/auth/session', 'GET', undefined, s)), { status: 401 });
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword(password + 'x', passwordHash), false);
});

test('personal standard ledger import and restore never overwrite the test ledger',async t=>{
  const h=setup(t),s=await h.login();
  const initial=await(await h.api.handle(h.request('/api/trade-records','GET',undefined,s))).json();
  const baseline={...emptyDataset(),evidence:'original historical ledger'};
  let response=await h.api.handle(h.request('/api/admin/ledgers','POST',{dataset:baseline},s));
  assert.equal(response.status,201);const imported=await response.json();
  assert.equal((await h.api.handle(h.request('/api/admin/ledgers','POST',{dataset:baseline},s))).status,409);
  let read=await(await h.api.handle(h.request(`/api/trade-records?accountId=${imported.account.id}`,'GET',undefined,s))).json();
  assert.deepEqual(read.dataset,baseline);assert.equal(read.accounts.length,2);
  const foreign={...s,user:{...s.user,id:'other-user'}};
  assert.equal((await h.api.handle(h.request('/api/trade-records?accountId=someone-else','GET',undefined,foreign))).status,403);
  const edited={...baseline,evidence:'edited history'};
  response=await h.api.handle(h.request('/api/trade-records','PUT',{accountId:imported.account.id,accountName:'標準歷史帳本',dataset:edited,baseVersion:1},s));
  assert.equal(response.status,200);
  const testLedger=await(await h.api.handle(h.request(`/api/trade-records?accountId=${initial.account.id}`,'GET',undefined,s))).json();
  assert.deepEqual(testLedger.dataset,initial.dataset);assert.equal(testLedger.account.version,1);
  const list=await(await h.api.handle(h.request('/api/admin/history','GET',undefined,s))).json();
  const pinned=list.items.find(row=>row.accountId===imported.account.id&&row.version===1);assert.equal(pinned.pinned,1);
  response=await h.api.handle(h.request('/api/admin/history?action=restore','POST',{id:pinned.id,baseVersion:2},s));assert.equal(response.status,200);
  read=await(await h.api.handle(h.request(`/api/trade-records?accountId=${imported.account.id}`,'GET',undefined,s))).json();
  assert.deepEqual(read.dataset,baseline);assert.equal(read.account.version,3);
  const unchanged=await(await h.api.handle(h.request(`/api/trade-records?accountId=${initial.account.id}`,'GET',undefined,s))).json();assert.deepEqual(unchanged.dataset, testLedger.dataset);assert.deepEqual(unchanged.account,testLedger.account);
});
