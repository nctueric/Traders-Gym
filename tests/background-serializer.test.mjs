import test from "node:test";
import assert from "node:assert/strict";
import { serializeInBackground } from "../lib/background-serializer.mjs";

test("background serializer has a deterministic non-worker fallback", async () => {
  const value = { fills: [{ id: "one", symbol: "NVTS" }], settings: { benchmarkSymbol: "SPY" } };
  assert.equal(await serializeInBackground(value, undefined), JSON.stringify(value));
});
