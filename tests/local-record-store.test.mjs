import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createLocalRecordStore, localRecordMiddleware } from "../server/local-record-store.mjs";
import { durableTradeDataset } from "../lib/trade-record-store.mjs";

const dataset = () => ({ version: "1", profile: { name: "測試" }, accounts: [{ id: "usd", currency: "USD" }], fills: [], cashActivities: [], marketBars: [], settings: {}, strategies: [{ id: "s", versions: [] }], cycleReviews: { cycle: { entryQualityTag: "IDEAL" } }, positionPlans: { one: { stopLoss: 10 } } });
const payload = (baseVersion = null, data = dataset()) => ({ accountId: "test", accountName: "測試帳號", baseVersion, dataset: data });
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "trade-record-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: createLocalRecordStore(root) };
}

test("folder snapshots survive a fresh store and retain importable immutable history", async t => {
  const { root, store } = await setup(t);
  assert.deepEqual(await store.list(), []);
  await store.save(payload());
  const original = await readFile(join(root, "目前帳號/test.json"), "utf8");
  assert.deepEqual(durableTradeDataset(JSON.parse(original)), dataset());
  const updated = { ...dataset(), cycleReviews: { cycle: { entryQualityTag: "LATE" } } };
  await store.save(payload(1, updated));
  assert.deepEqual((await createLocalRecordStore(root).read("test")).dataset, updated);
  assert.equal((await store.list())[0].version, 2);
  const files = await readdir(join(root, "歷史備份/test"));
  assert.equal(files.length, 2);
  assert.equal(await readFile(join(root, "歷史備份/test", files.find(f => f.startsWith("v00000001"))), "utf8"), original);
});

test("simultaneous edits cannot overwrite the same version or bypass it with null", async t => {
  const { store } = await setup(t);
  await store.save(payload());
  const results = await Promise.allSettled([store.save(payload(1)), store.save(payload(1))]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.status, 409);
  await assert.rejects(store.save(payload()), e => e.status === 409);
  assert.equal((await store.read("test")).account.version, 2);
});

test("tampered current data fails closed and preserves history", async t => {
  const { root, store } = await setup(t);
  await store.save(payload());
  const file = join(root, "目前帳號/test.json"), parsed = JSON.parse(await readFile(file, "utf8"));
  parsed.profile.name = "tampered";
  await writeFile(file, JSON.stringify(parsed));
  await assert.rejects(store.read("test"), /完整性/);
  await assert.rejects(store.save(payload(1)), /完整性/);
  assert.equal((await readdir(join(root, "歷史備份/test"))).length, 1);
});

test("invalid paths and an interrupted writer lock cannot clobber a snapshot", async t => {
  const { root, store } = await setup(t);
  await assert.rejects(store.read("../outside"), e => e.status === 400);
  await store.save(payload());
  await writeFile(join(root, "目前帳號/test.lock"), "interrupted writer");
  await assert.rejects(store.save(payload(1)), e => e.status === 503);
  assert.equal((await store.read("test")).account.version, 1);
});

async function request(middleware, method, url, body, headers = {}) {
  const req = Readable.from(body == null ? [] : [Buffer.from(body)]);
  Object.assign(req, { method, url, headers: { host: "127.0.0.1:3000", "content-type": "application/json", ...headers } });
  const res = { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; }, end(value) { this.body = JSON.parse(value); } };
  await middleware(req, res, () => { res.statusCode = 404; });
  return res;
}

test("local API GET and PUT use files, advertise the folder, and reject cross-origin writes", async t => {
  const { root, store } = await setup(t), middleware = localRecordMiddleware(store);
  const saved = await request(middleware, "PUT", "/api/trade-records", JSON.stringify(payload()));
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.storage.path, root);
  const loaded = await request(middleware, "GET", "/api/trade-records?accountId=test");
  assert.deepEqual(loaded.body.dataset, dataset());
  assert.equal(loaded.headers["Cache-Control"], "no-store");
  assert.equal((await request(middleware, "PUT", "/api/trade-records", JSON.stringify(payload(1)), { origin: "https://external.example" })).statusCode, 403);
  assert.equal((await request(middleware, "PUT", "/api/trade-records", "invalid")).statusCode, 400);
  assert.equal((await request(middleware, "GET", "/api/trade-records?accountId=missing")).statusCode, 404);
});
