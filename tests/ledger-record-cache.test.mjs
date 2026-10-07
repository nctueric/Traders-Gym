import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { usableCachedTradeRecord } from '../lib/ledger-record-cache.mjs';

const dataset = () => ({ version: '0.1.0', profile: { name: '快取帳本', baseCurrency: 'USD', costMethod: 'FIFO' }, accounts: [], fills: [], marketBars: [], settings: { quoteProvider: 'json' } });
const entry = () => ({ key: 'user:ledger', schema: 1, record: { account: { id: 'ledger', version: 7 }, accounts: [], dataset: dataset() } });

test('device cache is usable only for the exact user, ledger and cloud version', () => {
  assert.equal(usableCachedTradeRecord(entry(), { userId: 'user', accountId: 'ledger', version: 7 })?.cacheSource, 'device');
  for (const expected of [
    { userId: 'other', accountId: 'ledger', version: 7 },
    { userId: 'user', accountId: 'other', version: 7 },
    { userId: 'user', accountId: 'ledger', version: 8 },
  ]) assert.equal(usableCachedTradeRecord(entry(), expected), null);
});

test('invalid or corrupt cached records are rejected', () => {
  for (const invalid of [null, { ...entry(), schema: 2 }, { ...entry(), record: { ...entry().record, dataset: {} } }, { ...entry(), record: { ...entry().record, account: { id: 'ledger', version: '7' } } }])
    assert.equal(usableCachedTradeRecord(invalid, { userId: 'user', accountId: 'ledger', version: 7 }), null);
});

test('pending cache carries a verified cloud baseline for background save recovery', () => {
  const pending = { ...entry(), pending: true, baselineJson: JSON.stringify(dataset()) };
  const record = usableCachedTradeRecord(pending, { userId: 'user', accountId: 'ledger', version: 7 });
  assert.equal(record.cachePending, true);
  assert.equal(record.cacheBaselineJson, pending.baselineJson);
  assert.equal(usableCachedTradeRecord({ ...pending, baselineJson: '{}' }, { userId: 'user', accountId: 'ledger', version: 7 }), null);
});

test('fast workspace uses the exact-version cache and full workspace revalidates immediately', () => {
  const fast = readFileSync(new URL('../app/fast-workspace.tsx', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../app/trade-workspace.tsx', import.meta.url), 'utf8');
  assert.match(fast, /readLedgerRecordCache\(\{ userId: bootstrap\.user\.id, accountId: bootstrap\.account\.id, version: bootstrap\.account\.version \}\)/);
  assert.match(fast, /if \(cached\)[\s\S]*setRecord\(cached\);[\s\S]*return;/);
  assert.match(workspace, /window\.setTimeout\(refresh, 0\)/);
  assert.match(workspace, /writeLedgerRecordCache\([\s\S]*saved\.account/);
  assert.match(workspace, /cachePending \? payload\.cacheBaselineJson/);
});
