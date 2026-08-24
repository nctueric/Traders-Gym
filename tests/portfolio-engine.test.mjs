import test from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyEquitySeries } from "../lib/portfolio-engine.mjs";

test("weekly equity marks open holdings to the last weekly close", () => {
  const data = {
    cashActivities: [{ id: "cash", type: "DEPOSIT", amount: 1000, currency: "USD", timestamp: "2026-07-01T00:00:00Z" }],
    fills: [{ id: "buy", accountId: "a", symbol: "AAA", currency: "USD", side: "BUY", quantity: 10, price: 10, fee: 0, timestamp: "2026-07-01T09:00:00Z" }],
    marketBars: [{ symbol: "AAA", date: "2026-07-03", close: 12 }, { symbol: "AAA", date: "2026-07-10", close: 15 }],
  };
  const series = buildWeeklyEquitySeries(data, 32);
  assert.equal(series.length, 2);
  assert.equal(series[0].totalUsd, 1020);
  assert.equal(series[1].totalUsd, 1050);
  assert.equal(series[1].changeUsd, 30);
});

test("weekly equity converts TWD assets with USDTWD", () => {
  const data = { cashActivities: [{ id: "cash", type: "DEPOSIT", amount: 3200, currency: "TWD", timestamp: "2026-07-01T00:00:00Z" }], fills: [], marketBars: [] };
  assert.equal(buildWeeklyEquitySeries(data, 32)[0].totalUsd, 100);
});

test("weekly equity fails closed when TWD exists without FX", () => {
  const data = { cashActivities: [{ id: "cash", type: "DEPOSIT", amount: 3200, currency: "TWD", timestamp: "2026-07-01T00:00:00Z" }], fills: [], marketBars: [] };
  assert.equal(buildWeeklyEquitySeries(data, null)[0].totalUsd, null);
});
