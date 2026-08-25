import test from "node:test";
import assert from "node:assert/strict";
import { isDataset, makeRecordAccountId, selectStartupAccount, validateTradeRecordPayload } from "../lib/trade-record-store.mjs";

const dataset = { version: "1", profile: { name: "主要帳號" }, accounts: [], fills: [], marketBars: [], settings: {} };

test("recognizes a trade dataset", () => {
  assert.equal(isDataset(dataset), true);
  assert.equal(isDataset({ fills: [] }), false);
});

test("validates account snapshot writes", () => {
  const result = validateTradeRecordPayload({ accountId: "primary", accountName: "主要帳號", dataset, baseVersion: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.baseVersion, 2);
  assert.equal(validateTradeRecordPayload({ accountId: "bad id", accountName: "X", dataset }).ok, false);
});

test("restores preferred account or most recent account", () => {
  const accounts = [{ id: "latest" }, { id: "older" }];
  assert.equal(selectStartupAccount(accounts, "older").id, "older");
  assert.equal(selectStartupAccount(accounts, "missing").id, "latest");
  assert.equal(selectStartupAccount([], "missing"), null);
});

test("generates safe distinct account ids", () => {
  assert.equal(makeRecordAccountId("Growth Account", 123), "growth-account-123");
  assert.match(makeRecordAccountId("成長帳號", 456), /^account-456$/);
});
