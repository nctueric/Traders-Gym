import test from "node:test";
import assert from "node:assert/strict";
import { buildCurrentEquity, buildWeeklyEquitySeries, buildWeeklyPerformance, monthlyAssetChange, monthlyCycleScore } from "../lib/portfolio-engine.mjs";

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

test("current equity uses live quotes for open positions", () => {
  const data = {
    cashActivities: [{ id: "cash", type: "DEPOSIT", amount: 1000, currency: "USD", timestamp: "2026-07-01T00:00:00Z" }],
    fills: [{ id: "buy", accountId: "a", symbol: "AAA", market: "NASDAQ", currency: "USD", side: "BUY", quantity: 10, price: 10, fee: 0, timestamp: "2026-07-01T09:00:00Z" }],
    marketBars: [{ symbol: "AAA", date: "2026-07-01", close: 11 }],
  };
  const equity = buildCurrentEquity(data, { AAA: { price: 12 } }, 32, new Date("2026-08-25T00:00:00Z"));
  assert.equal(equity.totalUsd, 1020);
  assert.equal(equity.liveQuoteCount, 1);
  assert.deepEqual(equity.missingSymbols, []);
});

test("current equity falls back to the latest close and reports missing live quotes", () => {
  const data = { cashActivities: [], fills: [{ id: "buy", accountId: "a", symbol: "AAA", market: "NASDAQ", currency: "USD", side: "BUY", quantity: 10, price: 10, fee: 0, timestamp: "2026-07-01T09:00:00Z" }], marketBars: [{ symbol: "AAA", date: "2026-07-02", close: 11 }] };
  const equity = buildCurrentEquity(data, {}, 32);
  assert.equal(equity.totalUsd, 10);
  assert.deepEqual(equity.missingSymbols, ["AAA"]);
});

test("weekly performance aligns portfolio and benchmark week-over-week returns", () => {
  const equity = [
    { weekStart: "2026-08-03", asOf: "2026-08-07", totalUsd: 100, changePct: null },
    { weekStart: "2026-08-10", asOf: "2026-08-14", totalUsd: 110, changePct: 0.1 },
  ];
  const benchmark = [
    { date: "2026-07-31", close: 100 },
    { date: "2026-08-07", close: 102 },
    { date: "2026-08-14", close: 101 },
  ];
  const result = buildWeeklyPerformance(equity, benchmark);
  assert.ok(Math.abs(result[0].benchmarkPct - 0.02) < 1e-12);
  assert.ok(Math.abs(result[1].benchmarkPct - (101 / 102 - 1)) < 1e-12);
  assert.equal(result[1].portfolioPct, 0.1);
});

test("monthly asset change uses the last valid point before the month as baseline", () => {
  const points = [
    { asOf: "2026-07-31", totalUsd: 100 },
    { asOf: "2026-08-07", totalUsd: 110 },
    { asOf: "2026-08-14", totalUsd: 106 },
  ];
  assert.equal(monthlyAssetChange(points, "2026-08"), 6);
});

test("monthly asset change falls back to the first point inside the month", () => {
  const points = [{ asOf: "2026-08-07", totalUsd: 110 }, { asOf: "2026-08-14", totalUsd: 106 }];
  assert.equal(monthlyAssetChange(points, "2026-08"), -4);
});

test("monthly scorecard filters by close month and calculates average and win rate", () => {
  const score = monthlyCycleScore([
    { closeAt: "2026-08-01T00:00:00Z", returnPct: 0.1, pnl: 10 },
    { closeAt: "2026-08-20T00:00:00Z", returnPct: -0.04, pnl: -4 },
    { closeAt: "2026-07-31T00:00:00Z", returnPct: 0.2, pnl: 20 },
  ], "2026-08");
  assert.equal(score.cycles.length, 2);
  assert.ok(Math.abs(score.averageReturn - 0.03) < 1e-12);
  assert.equal(score.averageWinningReturn, 0.1);
  assert.equal(score.winners, 1);
  assert.equal(score.losers, 1);
  assert.equal(score.winRate, 0.5);
});

test("monthly average winning return is empty when there are no profitable cycles", () => {
  const score = monthlyCycleScore([{ closeAt: "2026-08-20T00:00:00Z", returnPct: -0.04, pnl: -4 }], "2026-08");
  assert.equal(score.averageWinningReturn, null);
});
