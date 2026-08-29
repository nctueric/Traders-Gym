import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalRecordStore, localRecordMiddleware } from "../server/local-record-store.mjs";
import { durableTradeJson } from "../lib/trade-record-store.mjs";
import { saveTradeRecord } from "../lib/trade-record-client.mjs";

const directory = await mkdtemp(join(tmpdir(), "trade-record-http-test-"));
let server;
async function start() {
  const middleware = localRecordMiddleware(createLocalRecordStore(directory));
  server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return (url, options) => fetch(base + url, options);
}
async function stop() { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
try {
  let fetcher = await start();
  const baseline = { profile: { name: "隔離測試" }, accounts: [], fills: [], cashActivities: [], settings: {}, marketBars: [] };
  const created = await saveTradeRecord({ accountId: "test", accountName: "隔離測試", baseVersion: null, baselineJson: durableTradeJson(baseline), serialized: durableTradeJson(baseline), fetcher });
  const modified = { ...baseline, strategies: [{ id: "s", status: "DRAFT" }], cycleReviews: { one: { entryQualityTag: "IDEAL", exitQualityTag: "LATE" } }, marketBars: [{ symbol: "AAA", date: "2026-08-28", close: 100, cache: "x".repeat(3_200_000) }], marketSnapshot: { version: 1, quotes: { "USDTWD=X": { price: 32, updatedAt: "2026-08-28T00:00:00Z" } }, benchmarkBars: [{ symbol: "SPY", date: "2026-08-28", close: 600 }], benchmarkSymbol: "SPY" } };
  // A large complete snapshot must survive the real HTTP boundary intact.
  const large = await fetcher("/api/trade-records", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: "test", accountName: "隔離測試", baseVersion: created.account.version, dataset: modified }) });
  assert.equal(large.status, 200);
  const outcomes = await Promise.all([1,2].map(() => fetcher("/api/trade-records", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: "test", accountName: "隔離測試", baseVersion: 2, dataset: modified }) })));
  assert.deepEqual(outcomes.map(r => r.status).sort(), [200,409]);
  await stop(); fetcher = await start();
  const reloaded = await (await fetcher("/api/trade-records?accountId=test")).json();
  assert.deepEqual(reloaded.dataset, modified);
  assert.equal(reloaded.account.version, 3);
  assert.equal((await readdir(join(directory, "歷史備份/test"))).length, 3);
  console.log("PASS: local HTTP create, 3.2 MB price cache, update, concurrent conflict, restart reload, and three historical backups");
} finally { if (server?.listening) await stop(); await rm(directory, { recursive: true, force: true }); }
