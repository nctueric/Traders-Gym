import test from "node:test";
import assert from "node:assert/strict";
import { buildCurrentEquity, buildPositionMetrics, buildWeeklyEquitySeries, buildWeeklyPerformance, monthlyAssetChange, monthlyCycleScore, cycleRangeScore, positionPortfolioImpactPct } from "../lib/portfolio-engine.mjs";

test("opening balance prevents earlier closed trades from changing current equity", () => {
  const base = { cashActivities: [{ id: "opening", type: "OPENING_BALANCE", amount: 1000, currency: "USD", timestamp: "2026-08-01T00:00:00Z" }], marketBars: [] };
  const historical = [
    { id: "old-buy", accountId: "a", symbol: "OLD", currency: "USD", side: "BUY", quantity: 10, price: 5, fee: 0, timestamp: "2026-07-01T00:00:00Z" },
    { id: "old-sell", accountId: "a", symbol: "OLD", currency: "USD", side: "SELL", quantity: 10, price: 8, fee: 0, timestamp: "2026-07-02T00:00:00Z" },
  ];
  assert.equal(buildCurrentEquity({ ...base, fills: historical }, {}, 32).totalUsd, 1000);
});

test("current equity fallback price uses latest fill regardless of CSV row order", () => {
  const data = { cashActivities: [], marketBars: [], fills: [
    { id: "new", accountId: "a", symbol: "AAA", currency: "USD", side: "BUY", quantity: 1, price: 12, fee: 0, timestamp: "2026-08-02T00:00:00Z" },
    { id: "old", accountId: "a", symbol: "AAA", currency: "USD", side: "BUY", quantity: 1, price: 10, fee: 0, timestamp: "2026-08-01T00:00:00Z" },
  ] };
  assert.equal(buildCurrentEquity(data, {}, 32).assetByCurrency.USD, 2);
});

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

test("weekly equity ignores replay candles before the account has any activity", () => {
  const data = {
    cashActivities: [{ id: "cash", type: "DEPOSIT", amount: 1000, currency: "USD", timestamp: "2026-08-04T00:00:00Z" }],
    fills: [{ id: "buy", accountId: "a", symbol: "AAA", currency: "USD", side: "BUY", quantity: 10, price: 10, fee: 0, timestamp: "2026-08-04T09:00:00Z" }],
    marketBars: [{ symbol: "AAA", date: "2026-05-01", close: 8 }, { symbol: "AAA", date: "2026-08-07", close: 12 }],
  };
  const series = buildWeeklyEquitySeries(data, 32);
  assert.deepEqual(series.map((point) => point.weekStart), ["2026-08-03"]);
  assert.equal(series[0].totalUsd, 1020);
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

test("long position metrics calculate allocation, risk reward, and stop breach", () => {
  const metrics = buildPositionMetrics({ direction: "LONG", averageCost: 100, quantity: 10, currency: "USD" }, 90, 95, 2_000, 32, 120);
  assert.equal(metrics.unrealized, -100);
  assert.equal(metrics.unrealizedUsd, -100);
  assert.equal(metrics.marketValueUsd, 900);
  assert.equal(metrics.marketValue, 900);
  assert.equal(metrics.allocationPct, 0.45);
  assert.equal(metrics.stopLossAmount, 50);
  assert.equal(metrics.stopLossAmountUsd, 50);
  assert.equal(metrics.stopDistance, -5);
  assert.equal(metrics.stopDistancePct, -5 / 90);
  assert.equal(metrics.riskReward, -2);
  assert.equal(metrics.stopBreached, true);
  assert.equal(metrics.takeProfitOutcome, 300);
  assert.equal(metrics.takeProfitOutcomeUsd, 300);
  assert.equal(metrics.stopOutcome, 50);
  assert.equal(metrics.stopOutcomeUsd, 50);
});

test("short position metrics use the inverse stop direction", () => {
  const metrics = buildPositionMetrics({ direction: "SHORT", averageCost: 100, quantity: 10, currency: "USD" }, 112, 110, 2_000, 32);
  assert.equal(metrics.unrealized, -120);
  assert.equal(metrics.stopLossAmount, 100);
  assert.equal(metrics.stopDistance, -2);
  assert.equal(metrics.riskReward, -1.2);
  assert.equal(metrics.stopBreached, true);
});

test("TWD position allocation converts market value to USD", () => {
  const metrics = buildPositionMetrics({ direction: "LONG", averageCost: 90, quantity: 100, currency: "TWD" }, 96, 80, 10_000, 32);
  assert.equal(metrics.marketValueUsd, 300);
  assert.equal(metrics.allocationPct, 0.03);
  assert.equal(metrics.unrealizedUsd, 18.75);
  assert.equal(metrics.stopLossAmountUsd, 31.25);
});

test("position stop distance stays positive before a long stop is reached", () => {
  const metrics = buildPositionMetrics({ direction: "LONG", averageCost: 100, quantity: 10, currency: "USD" }, 110, 95, 2_000, 32);
  assert.equal(metrics.stopDistance, 15);
  assert.equal(metrics.stopDistancePct, 15 / 110);
  assert.equal(metrics.stopBreached, false);
});

test("position preserves native risk but withholds USD values when FX is missing", () => {
  const metrics = buildPositionMetrics({ direction: "LONG", averageCost: 90, quantity: 100, currency: "TWD" }, 96, 80, 10_000, null, 120);
  assert.equal(metrics.unrealized, 600);
  assert.equal(metrics.stopLossAmount, 1_000);
  assert.equal(metrics.unrealizedUsd, null);
  assert.equal(metrics.stopLossAmountUsd, null);
  assert.equal(metrics.allocationPct, null);
  assert.equal(metrics.takeProfitOutcome, 2_400);
  assert.equal(metrics.takeProfitOutcomeUsd, null);
  assert.equal(metrics.stopOutcome, -1_600);
  assert.equal(metrics.stopOutcomeUsd, null);
});

test("short position targets calculate signed outcomes from the live price", () => {
  const metrics = buildPositionMetrics({ direction: "SHORT", averageCost: 100, quantity: 10, currency: "USD" }, 90, 105, 2_000, 32, 70);
  assert.equal(metrics.takeProfitOutcome, 200);
  assert.equal(metrics.stopOutcome, -150);
});

test("planned price outcomes are measured against total open-position value", () => {
  assert.equal(positionPortfolioImpactPct(300, 10_000), 0.03);
  assert.equal(positionPortfolioImpactPct(-150, 10_000), -0.015);
  assert.equal(positionPortfolioImpactPct(100, 0), null);
  assert.equal(positionPortfolioImpactPct(null, 10_000), null);
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
    { closeAt: "2026-08-01T00:00:00Z", returnPct: 0.1, pnl: 10, currency: "USD" },
    { closeAt: "2026-08-20T00:00:00Z", returnPct: -0.04, pnl: -4, currency: "USD" },
    { closeAt: "2026-07-31T00:00:00Z", returnPct: 0.2, pnl: 20, currency: "USD" },
  ], "2026-08");
  assert.equal(score.cycles.length, 2);
  assert.ok(Math.abs(score.averageReturn - 0.03) < 1e-12);
  assert.equal(score.averageWinningReturn, 0.1);
  assert.equal(score.averageLosingReturn, -0.04);
  assert.deepEqual(score.averageWinningAmountByCurrency, { USD: 10 });
  assert.deepEqual(score.averageLosingAmountByCurrency, { USD: -4 });
  assert.deepEqual(score.totalPnlByCurrency, { USD: 6 });
  assert.equal(score.averageWinningAmountUsd, 10);
  assert.equal(score.averageLosingAmountUsd, -4);
  assert.equal(score.totalPnlUsd, 6);
  assert.equal(score.winners, 1);
  assert.equal(score.losers, 1);
  assert.equal(score.winRate, 0.5);
});

test("monthly average winning return is empty when there are no profitable cycles", () => {
  const score = monthlyCycleScore([{ closeAt: "2026-08-20T00:00:00Z", returnPct: -0.04, pnl: -4 }], "2026-08");
  assert.equal(score.averageWinningReturn, null);
});

test("monthly scorecard converts mixed-currency profit and loss amounts to USD", () => {
  const score = monthlyCycleScore([
    { closeAt: "2026-08-02T00:00:00Z", returnPct: 0.1, pnl: 10, currency: "USD" },
    { closeAt: "2026-08-03T00:00:00Z", returnPct: 0.2, pnl: 30, currency: "USD" },
    { closeAt: "2026-08-04T00:00:00Z", returnPct: 0.05, pnl: 1_000, currency: "TWD" },
    { closeAt: "2026-08-05T00:00:00Z", returnPct: -0.05, pnl: -8, currency: "USD" },
    { closeAt: "2026-08-06T00:00:00Z", returnPct: -0.1, pnl: -2_000, currency: "TWD" },
  ], "2026-08", 32);
  assert.deepEqual(score.averageWinningAmountByCurrency, { USD: 20, TWD: 1_000 });
  assert.deepEqual(score.averageLosingAmountByCurrency, { USD: -8, TWD: -2_000 });
  assert.deepEqual(score.totalPnlByCurrency, { USD: 32, TWD: -1_000 });
  assert.equal(score.averageWinningAmountUsd, 23.75);
  assert.equal(score.averageLosingAmountUsd, -35.25);
  assert.equal(score.totalPnlUsd, 0.75);
});

test("monthly USD score amounts fail closed when TWD exists without FX", () => {
  const score = monthlyCycleScore([{ closeAt: "2026-08-02T00:00:00Z", returnPct: 0.1, pnl: 1_000, currency: "TWD" }], "2026-08", null);
  assert.equal(score.averageWinningAmountUsd, null);
  assert.equal(score.totalPnlUsd, null);
});

test("range score preserves the original current-month score exactly", () => {
  const cycles = [
    { id:"jul", closeAt:"2026-07-31T23:30:00Z", pnl:20, returnPct:.2, currency:"USD" },
    { id:"aug", closeAt:"2026-08-31T23:59:59Z", pnl:-10, returnPct:-.1, currency:"USD" },
    { id:"sep", closeAt:"2026-09-01T00:00:00Z", pnl:5, returnPct:.05, currency:"USD" },
  ];
  const { error, ...score } = cycleRangeScore(cycles,"2026-08-01","2026-08-31",32);
  assert.equal(error,"");
  assert.deepEqual(score, monthlyCycleScore(cycles,"2026-08",32));
  assert.deepEqual(score.cycles.map(c=>c.id),["aug"]);
  assert.deepEqual(cycleRangeScore(cycles,"2026-07-31","2026-08-31",32).cycles.map(c=>c.id),["jul","aug"]);
});

test("range score includes breakeven trades and converts mixed currencies without changing source", () => {
  const cycles = [
    { closeAt:"2026-01-02",pnl:100,returnPct:.1,currency:"USD",direction:"SHORT" },
    { closeAt:"2026-08-20",pnl:-320,returnPct:-.05,currency:"TWD" },
    { closeAt:"2026-08-21",pnl:0,returnPct:0,currency:"USD" },
  ];
  const before=structuredClone(cycles),score=cycleRangeScore(cycles,"","",32);
  assert.equal(score.totalPnlUsd,90);assert.equal(score.winners,1);assert.equal(score.losers,1);assert.equal(score.flat,1);
  assert.equal(score.winRate,.5);assert.equal(score.averageLosingAmountUsd,-10);
  assert.equal(cycleRangeScore(cycles,"","",null).totalPnlUsd,null);
  assert.deepEqual(cycles,before);
});

test("invalid ranges fail closed and no-exit records never enter the score", () => {
  const cycles=[{closeAt:"2026-08-20",pnl:10,returnPct:.1},{pnl:100,returnPct:1}];
  for(const [start,end] of [["2026-08-30","2026-08-01"],["2026-02-30","2026-03-31"],["bad","2026-08-31"]]){
    const result=cycleRangeScore(cycles,start,end,32);assert.ok(result.error);assert.equal(result.cycles.length,0);
  }
  assert.equal(cycleRangeScore(cycles,"","",32).cycles.length,1);
  const empty=cycleRangeScore(cycles,"2026-07-01","2026-07-31",32);
  assert.equal(empty.error,"");assert.equal(empty.cycles.length,0);assert.equal(empty.averageReturn,null);assert.equal(empty.winRate,null);
});
