import {decodeSnapshotRequest} from "../lib/snapshot-transport.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildTradeSnapshot, restoreMarketSnapshot, reconcileTradeSnapshots } from "../lib/trade-snapshot.mjs";
import { completeTradeJson, durableTradeJson } from "../lib/trade-record-store.mjs";
import { readPendingRecord, writeLocalRecord, saveTradeRecord } from "../lib/trade-record-client.mjs";
import { createLocalRecordStore } from "../server/local-record-store.mjs";
import { buildCurrentEquity, buildWeeklyEquitySeries, cycleRangeScore } from "../lib/portfolio-engine.mjs";
import { summarize } from "../lib/trade-engine.mjs";
import { fixtureDataset } from "./ui-fixture-data.mjs";

const stamp = "2026-08-28T02:00:00Z";
function fixture() {
  return buildTradeSnapshot({ ...fixtureDataset("rich"), extraFutureField: { retained: true }, positionPlans: { one: { stopLoss: 10, takeProfit: 20, note: "計畫證據" } }, planHistory: [{ id: "version1", value: 10 }], improvementExperiments: [{ id: "experiment", resultNote: "改善" }], decisionLinks: { one: { linked: true } }, decisionLinkHistory: [{ linked: true }] }, {
    quotes: { "USDTWD=X": { symbol: "USDTWD=X", price: 32, updatedAt: stamp, source: "test" } },
    lastQuoteAt: Date.parse(stamp), benchmarkSymbol: "SPY", benchmarkBars: [{ symbol: "SPY", date: "2026-08-27", close: 600 }],
  });
}
async function storeFor(t) {
  const root = await mkdtemp(join(tmpdir(), "trade-complete-snapshot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: createLocalRecordStore(root) };
}
const payload = (dataset, baseVersion, saveMode = "manual") => ({ accountId: "test", accountName: "測試", dataset, baseVersion, saveMode });

test("manual full snapshot round trip preserves every field and derived assets, cycles and metrics", async t => {
  const { root, store } = await storeFor(t), source = fixture();
  await store.save(payload(source, null));
  const loaded = (await createLocalRecordStore(root).read("test")).dataset;
  assert.deepEqual(loaded, source);
  const runtime = restoreMarketSnapshot(loaded);
  assert.deepEqual(runtime, restoreMarketSnapshot(source));
  assert.deepEqual(summarize(loaded), summarize(source));
  assert.deepEqual(buildCurrentEquity(loaded, runtime.quotes, 32, new Date(stamp)), buildCurrentEquity(source, runtime.quotes, 32, new Date(stamp)));
  assert.deepEqual(buildWeeklyEquitySeries(loaded, 32), buildWeeklyEquitySeries(source, 32));
  const expectedScore = cycleRangeScore(summarize(source).cycles, "", "", 32);
  assert.equal(expectedScore.error, "");
  assert.ok(expectedScore.cycles.length > 0);
  assert.deepEqual(cycleRangeScore(summarize(loaded).cycles, "", "", 32), expectedScore);
  assert.deepEqual(JSON.parse(completeTradeJson({ ...loaded, _storage: { ignored: true } })), source);
});

test("market-only autosaves retain full current state without creating a large archive every 30 seconds", async t => {
  const { root, store } = await storeFor(t), source = fixture();
  await store.save(payload(source, null));
  const updated = structuredClone(source);
  updated.marketSnapshot.quotes["USDTWD=X"].price = 33;
  await store.save(payload(updated, 1, "auto"));
  assert.deepEqual((await createLocalRecordStore(root).read("test")).dataset, updated);
  assert.equal((await readdir(join(root, "歷史備份/test"))).length, 1);
  await store.save(payload(updated, 2, "manual"));
  assert.equal((await readdir(join(root, "歷史備份/test"))).length, 2);
  updated.positionPlans.one.note = "新計畫";
  await store.save(payload(updated, 3, "auto"));
  assert.equal((await readdir(join(root, "歷史備份/test"))).length, 3);
  await assert.rejects(store.save(payload(JSON.parse(durableTradeJson(updated)), 4)), /舊版儲存格式/);
});

test("legacy backup restores honestly without fabricated market or planning data", () => {
  const legacy = { profile: { name: "舊資料" }, accounts: [], fills: [], marketBars: [], settings: {} };
  assert.deepEqual(restoreMarketSnapshot(legacy), { quotes: {}, lastQuoteAt: null, benchmarkSymbol: "SPY", benchmarkBars: [] });
  assert.equal(JSON.parse(completeTradeJson(legacy)).positionPlans, undefined);
  const saved = fixture(); saved.settings.benchmarkSymbol = "QQQ";
  assert.deepEqual(restoreMarketSnapshot(saved).benchmarkBars, [], "SPY cannot be relabeled QQQ");
});

test("emergency ledger recovery preserves server OHLC, FX and benchmark evidence without exhausting localStorage", () => {
  const server = fixture(); server.marketBars.push({ symbol: "AAA", date: "2026-08-27", close: 100, detail: "x".repeat(3_200_000) });
  const edit = structuredClone(server); edit.positionPlans.one.note = "尚未同步";
  const values = new Map(), storage = { setItem(k,v) { assert.ok(v.length < 100_000); values.set(k,v); }, getItem: k => values.get(k) || null };
  assert.equal(writeLocalRecord(storage, "records", "test", completeTradeJson(edit), completeTradeJson(server), 1), true);
  const restored = readPendingRecord(storage, "records", "test", server);
  assert.equal(restored.archivedPending, true);
  assert.equal(JSON.parse(JSON.parse(values.get(restored.recoveryKey)).serialized).positionPlans.one.note, "尚未同步");
  assert.deepEqual(restored.dataset.positionPlans,server.positionPlans);
  assert.deepEqual(restored.dataset.marketSnapshot, server.marketSnapshot);
  assert.deepEqual(restored.dataset.marketBars, server.marketBars);
});

test("cache-only cross-tab changes merge newer quotes without overwriting independently edited plans", async () => {
  const baseline = fixture(), local = structuredClone(baseline), server = structuredClone(baseline);
  local.positionPlans.one.note = "本頁計畫";
  server.marketSnapshot.quotes["USDTWD=X"] = { price: 33, updatedAt: "2026-08-28T03:00:00Z" };
  const merged = reconcileTradeSnapshots(local, server, completeTradeJson(baseline));
  assert.equal(merged.positionPlans.one.note, "本頁計畫");
  assert.equal(merged.marketSnapshot.quotes["USDTWD=X"].price, 33);
  let writes = 0;
  const saved = await saveTradeRecord({ accountId: "test", accountName: "測試", baseVersion: 1, baselineJson: completeTradeJson(baseline), serialized: completeTradeJson(local), fetcher: async (url, options) => {
    if (options.method === "GET") return { ok: true, json: async () => ({ dataset: server, account: { version: 2 } }) };
    if (++writes === 1) return { ok: false, status: 409, json: async () => ({}) };
    assert.deepEqual((await decodeSnapshotRequest(new Request("https://example.test",options))).dataset, merged);
    return { ok: true, json: async () => ({ account: { version: 3 } }) };
  } });
  assert.equal(saved.account.version, 3);
  server.positionPlans.one.note = "另一頁計畫";
  assert.equal(reconcileTradeSnapshots(local, server, completeTradeJson(baseline)), null);
});
