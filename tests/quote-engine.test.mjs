import test from "node:test";
import assert from "node:assert/strict";
import { normalizeYahooChart, QUOTE_REFRESH_MS, toProviderSymbol } from "../lib/quote-engine.mjs";

test("quote refresh interval is exactly 30 seconds", () => assert.equal(QUOTE_REFRESH_MS, 30_000));
test("US symbol stays unchanged", () => assert.equal(toProviderSymbol("aapl", "NASDAQ"), "AAPL"));
test("TWSE ticker receives .TW suffix", () => assert.equal(toProviderSymbol("2330", "TWSE"), "2330.TW"));
test("TPEX ticker receives .TWO suffix", () => assert.equal(toProviderSymbol("3675", "TPEX"), "3675.TWO"));
test("Yahoo chart payload is normalized", () => {
  const quote = normalizeYahooChart("AAPL", { chart: { result: [{ meta: { regularMarketPrice: 110, chartPreviousClose: 100, currency: "USD", regularMarketTime: 1_700_000_000 } }] } });
  assert.equal(quote.price, 110); assert.ok(Math.abs(quote.changePct - 0.1) < 1e-12); assert.equal(quote.currency, "USD");
});
test("missing quote data throws instead of fabricating price", () => assert.throws(() => normalizeYahooChart("BAD", { chart: { result: [] } })));
