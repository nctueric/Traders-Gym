import test from "node:test";
import assert from "node:assert/strict";
import { serializeInBackground } from "../lib/background-serializer.mjs";

test("background serializer has a deterministic non-worker fallback", async () => {
  const value = { fills: [{ id: "one", symbol: "NVTS" }], settings: { benchmarkSymbol: "SPY" } };
  assert.equal(await serializeInBackground(value, undefined), JSON.stringify(value));
});

test("worker loading or message failure falls back without losing data", async () => {
  const value = { strategies: [1], cycleReviews: { one: { entryQualityTag: "IDEAL" } } };
  for (const Worker of [class { constructor() { throw Error("blocked"); } }, class { postMessage() { this.onerror(); } terminate() {} }, class { postMessage() { this.onmessage({ data: { error: "failed" } }); } terminate() {} }]) {
    assert.equal(await serializeInBackground(value, Worker), JSON.stringify(value));
  }
});

test("unresponsive worker times out and is terminated", async () => {
  let terminated = false;
  class Worker { postMessage() {} terminate() { terminated = true; } }
  assert.equal(await serializeInBackground({ value: 1 }, Worker, 5), '{"value":1}');
  assert.equal(terminated, true);
});
