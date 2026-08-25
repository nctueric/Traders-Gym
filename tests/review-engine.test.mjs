import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCycle, findRapidRepurchases, taipeiWeekStart, weeklyCycleStats } from "../lib/review-engine.mjs";

const cycle = { id: "c1", accountId: "a", symbol: "AAA", currency: "USD", direction: "LONG", openAt: "2026-08-03T01:30:00Z", closeAt: "2026-08-05T08:00:00Z", averageEntry: 100, averageExit: 108, quantity: 10, pnl: 80, returnPct: 0.08, maePct: -0.05, mfePct: 0.2 };

test("Taipei week starts on Monday", () => {
  assert.equal(taipeiWeekStart("2026-08-09T18:00:00Z"), "2026-08-10");
});

test("cycle analysis calculates holding quality, giveback, post-exit returns, and R", () => {
  const bars = [
    { symbol: "AAA", date: "2026-08-03", close: 101 },
    { symbol: "AAA", date: "2026-08-04", close: 105 },
    { symbol: "AAA", date: "2026-08-05", close: 108 },
    { symbol: "AAA", date: "2026-08-06", close: 110 },
    { symbol: "AAA", date: "2026-08-07", close: 106 },
    { symbol: "AAA", date: "2026-08-10", close: 112 },
  ];
  const result = analyzeCycle(cycle, bars, { plannedStop: 95, revisedStop: 90 });
  assert.equal(result.tradingDays, 3);
  assert.equal(result.sameDay, false);
  assert.ok(Math.abs(result.mfeRetention - 0.4) < 1e-12);
  assert.ok(Math.abs(result.maxGiveback - 0.12) < 1e-12);
  assert.equal(result.postExitReturns[1], 2 / 108);
  assert.equal(result.postExitReturns[3], 4 / 108);
  assert.equal(result.initialRisk, 50);
  assert.equal(result.rMultiple, 1.6);
  assert.equal(result.stopDelayCost, 0);
  assert.equal(result.ruleModificationCost, 50);
});

test("same-day cycle is explicitly marked as daily approximation", () => {
  const result = analyzeCycle({ ...cycle, closeAt: "2026-08-03T06:00:00Z" }, [{ symbol: "AAA", date: "2026-08-03", close: 108 }]);
  assert.equal(result.sameDay, true);
  assert.equal(result.precision, "日線近似");
});

test("rapid repurchase uses a three-trading-day window", () => {
  const pairs = findRapidRepurchases([
    cycle,
    { ...cycle, id: "c2", openAt: "2026-08-10T01:00:00Z", closeAt: "2026-08-11T01:00:00Z" },
    { ...cycle, id: "c3", openAt: "2026-08-20T01:00:00Z", closeAt: "2026-08-21T01:00:00Z" },
  ]);
  assert.deepEqual(pairs.map((pair) => [pair.previousCycleId, pair.nextCycleId, pair.gapTradingDays]), [["c1", "c2", 3]]);
});

test("weekly cycle stats group by Taipei close week and convert PnL", () => {
  const stats = weeklyCycleStats([cycle, { ...cycle, id: "c2", currency: "TWD", pnl: -320, returnPct: -0.04 }], 32);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].sampleCount, 2);
  assert.equal(stats[0].averageReturn, 0.02);
  assert.equal(stats[0].winRate, 0.5);
  assert.equal(stats[0].totalPnlUsd, 70);
});

test("cycle analysis does not invent post-exit or R data", () => {
  const result = analyzeCycle(cycle, [], {});
  assert.equal(result.postExitReturns[20], null);
  assert.equal(result.rMultiple, null);
  assert.equal(result.stopDelayCost, null);
  assert.equal(result.ruleModificationCost, null);
  assert.equal(result.precision, "缺行情");
});
