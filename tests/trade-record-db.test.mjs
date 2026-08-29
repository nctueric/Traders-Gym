import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeTradeRecord } from "../lib/trade-record-db.mjs";

test("database version check is atomic, including creation and missing-version writes", async t => {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  sqlite.exec("CREATE TABLE trade_account_snapshots(account_id TEXT PRIMARY KEY, account_name TEXT, dataset_json TEXT, version INTEGER, updated_at TEXT)");
  const db = { prepare(sql) { return { bind(...args) { return { async first() { return sqlite.prepare(sql).get(...args) || null; } }; } }; } };
  const input = { accountId: "one", accountName: "測試", datasetJson: "{}", baseVersion: null };
  assert.equal((await writeTradeRecord(db, input)).version, 1);
  assert.equal(await writeTradeRecord(db, input), null);
  const results = await Promise.all([writeTradeRecord(db, { ...input, baseVersion: 1 }), writeTradeRecord(db, { ...input, baseVersion: 1 })]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.find(Boolean).version, 2);
  assert.equal(await writeTradeRecord(db, { ...input, accountId: "missing", baseVersion: 5 }), null);
});
