import test from "node:test";
import assert from "node:assert/strict";
import { FX_STALE_MS, isQuoteStale, normalizeYahooChart, pnlToUsd, QUOTE_REFRESH_MS, toProviderSymbol, twdToUsd, USDTWD_SYMBOL } from "../lib/quote-engine.mjs";

test("quote refresh interval is exactly 30 seconds", () => assert.equal(QUOTE_REFRESH_MS, 30_000));
test("US symbol stays unchanged", () => assert.equal(toProviderSymbol("aapl", "NASDAQ"), "AAPL"));
test("TWSE ticker receives .TW suffix", () => assert.equal(toProviderSymbol("2330", "TWSE"), "2330.TW"));
test("TWSE alphanumeric ETF receives .TW suffix", () => assert.equal(toProviderSymbol("00981A", "TWSE"), "00981A.TW"));
test("TPEX ticker receives .TWO suffix", () => assert.equal(toProviderSymbol("3675", "TPEX"), "3675.TWO"));
test("Yahoo chart payload is normalized", () => {
  const quote = normalizeYahooChart("AAPL", { chart: { result: [{ meta: { regularMarketPrice: 110, chartPreviousClose: 100, currency: "USD", regularMarketTime: 1_700_000_000 } }] } });
  assert.equal(quote.price, 110); assert.ok(Math.abs(quote.changePct - 0.1) < 1e-12); assert.equal(quote.currency, "USD");
});
test("missing quote data throws instead of fabricating price", () => assert.throws(() => normalizeYahooChart("BAD", { chart: { result: [] } })));
test("USDTWD provider symbol is explicit", () => assert.equal(USDTWD_SYMBOL, "USDTWD=X"));
test("TWD converts to USD by division", () => assert.equal(twdToUsd(3200, 32), 100));
test("mixed currency P&L converts to USD", () => assert.equal(pnlToUsd({ USD: 250, TWD: -3200 }, 32), 150));
test("invalid FX rate fails closed", () => assert.equal(pnlToUsd({ USD: 250, TWD: 100 }, 0), null));
test("FX quote becomes stale after two minutes", () => { const now = Date.parse("2026-08-21T12:02:01Z"); assert.equal(FX_STALE_MS, 120_000); assert.equal(isQuoteStale("2026-08-21T12:00:00Z", now), true); assert.equal(isQuoteStale("2026-08-21T12:01:00Z", now), false); });
