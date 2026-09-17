// Live smoke test for a NEW, EMPTY personal trial. Credentials are read from stdin.
// Saves synthetic snapshots, verifies D1/R2 round trips, then restores the original.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const origin = new URL(process.argv[2]).origin;
const local = ['localhost', '127.0.0.1'].includes(new URL(origin).hostname);
if (!origin.startsWith('https://') && !local) throw new Error('HTTPS is required');
let input = '';
for await (const chunk of process.stdin) input += chunk;
const credentials = JSON.parse(input); input = '';
let cookie = '', sessionId = '', original, account, changed = false;
const checks = [];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function call(path, { method = 'GET', body, anonymous = false, foreign = false } = {}) {
  return fetch(origin + path, { method, redirect: 'manual', signal: AbortSignal.timeout(60000), headers: {
    Origin: foreign ? 'https://example.invalid' : origin, 'Content-Type': 'application/json',
    ...(!anonymous && cookie ? { Cookie: cookie, 'x-workspace-session': sessionId } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function expect(path, options, status, name) {
  const response = await call(path, options);
  assert.equal(response.status, status, `${name}: HTTP ${response.status}`);
  checks.push(name); return response;
}
async function save(dataset, version, name) {
  const r = await expect('/api/trade-records', { method: 'PUT', body: {
    accountId: account.id, accountName: name, baseVersion: version, dataset,
  } }, 200, `save ${name}`);
  changed = true; account = (await r.json()).account;
}
try {
  await expect('/api/trade-records', { anonymous: true }, 401, 'anonymous ledger denied');
  await expect('/api/auth/password', { method: 'POST', body: credentials, foreign: true }, 403, 'cross-site login denied');
  await expect('/api/auth/password', { method: 'POST', body: { ...credentials, password: 'wrong-smoke-test-password' } }, 401, 'wrong password denied');
  const login = await expect('/api/auth/password', { method: 'POST', body: credentials }, 200, 'password login');
  delete credentials.password;
  const setCookie = login.headers.get('set-cookie');
  for (const flag of ['HttpOnly', ...(!local ? ['Secure'] : []), 'SameSite=Lax', 'Max-Age=43200']) assert.ok(setCookie?.includes(flag));
  cookie = setCookie.split(';')[0];
  const session = await (await expect('/api/auth/session', {}, 200, 'session read')).json();
  sessionId = session.user.sessionId;
  assert.equal(session.user.authProvider, 'password');
  await expect('/api/auth/google', { method: 'POST', body: {} }, 403, 'Google disabled');
  await expect('/api/admin/accounts', {}, 403, 'account administration disabled');
  const initial = await (await expect('/api/trade-records', {}, 200, 'initial ledger')).json();
  original = initial.dataset; account = initial.account;
  assert.equal(account.version, 1, 'Refuse to modify an existing trial ledger');
  assert.equal(original.fills.length, 0, 'Refuse to modify real trades');
  assert.equal(original.cashActivities.length, 0, 'Refuse to modify real cash activities');
  await expect('/api/trade-records?accountId=primary', {}, 403, 'other ledger denied');
  await expect('/api/trade-records', { method: 'PUT', body: {}, foreign: true }, 403, 'cross-site write denied');
  const small = { ...original, qaEvidence: { synthetic: true, purpose: 'Cloudflare D1/R2 acceptance' } };
  await save(small, account.version, 'QA small');
  assert.equal(digest((await (await call('/api/trade-records')).json()).dataset), digest(small));
  checks.push('small D1 SHA-256 round trip');
  const stale = account.version;
  const large = { ...small, qaPadding: 'X'.repeat(1900000) };
  await save(large, account.version, 'QA large');
  assert.equal(digest((await (await call('/api/trade-records')).json()).dataset), digest(large));
  checks.push('large R2 SHA-256 round trip');
  await expect('/api/trade-records', { method: 'PUT', body: { accountId: account.id, accountName: 'QA stale', dataset: small, baseVersion: stale } }, 409, 'stale version conflict');
  const history = await (await expect('/api/admin/history', {}, 200, 'history list')).json();
  const smallVersion = history.items.find(item => item.version === stale);
  assert.ok(smallVersion);
  await expect('/api/admin/history?action=restore', { method: 'POST', body: { id: smallVersion.id, baseVersion: account.version } }, 200, 'restore creates new version');
  const restored = await (await call('/api/trade-records')).json();
  assert.equal(restored.account.version, account.version + 1);
  assert.equal(digest(restored.dataset), digest(small)); account = restored.account;
  checks.push('restored small snapshot hash');
} finally {
  if (changed && original) {
    const latest = await (await call('/api/trade-records')).json();
    account = latest.account;
    await save(original, account.version, original.profile.name);
    const final = await (await call('/api/trade-records')).json();
    assert.equal(digest(final.dataset), digest(original));
    checks.push('original empty ledger restored');
  }
  if (cookie && sessionId) {
    await expect('/api/auth/logout', { method: 'POST', body: {} }, 200, 'logout');
    await expect('/api/trade-records', {}, 401, 'logged-out session rejected');
  }
  const report = { testedAt: new Date().toISOString(), origin, checks, finalVersion: account?.version,
    syntheticHistoryRetained: changed, originalSha256: original ? digest(original) : null };
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
