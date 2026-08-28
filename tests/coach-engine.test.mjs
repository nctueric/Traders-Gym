import test from "node:test";
import assert from "node:assert/strict";
import { buildBehaviorDashboard, buildCoachFindings, buildCycleReplay, buildMonthlyExpectancyTrend, buildOpenPositionReplay, buildProfitLossTradeStats, buildTradeQualityAnalysis, createExperimentFromFinding, cycleAnalysisPeriod, detectBehaviorEvents, evaluateExperiment, filterCyclesByPeriod, openPositionWindowDates, replayWindowDates } from "../lib/coach-engine.mjs";

const cycle = {
  id: "cycle-long",
  accountId: "main",
  symbol: "AAA",
  market: "NASDAQ",
  currency: "USD",
  direction: "LONG",
  openAt: "2026-08-03T14:30:00Z",
  closeAt: "2026-08-06T14:30:00Z",
  averageEntry: 100,
  averageExit: 102,
  entryNotional: 1_500,
  quantity: 15,
  pnl: 30,
  returnPct: 0.02,
  maePct: -0.08,
  mfePct: 0.2,
  fills: [
    { id: "buy-1", side: "BUY", quantity: 10, price: 100, timestamp: "2026-08-03T14:30:00Z" },
    { id: "buy-2", side: "BUY", quantity: 5, price: 96, timestamp: "2026-08-04T14:30:00Z" },
    { id: "sell-1", side: "SELL", quantity: 5, price: 110, timestamp: "2026-08-05T14:30:00Z" },
    { id: "sell-2", side: "SELL", quantity: 10, price: 98, timestamp: "2026-08-06T14:30:00Z" },
  ],
};

const bars = [
  { symbol: "AAA", date: "2026-08-03", open: 96, high: 105, low: 94, close: 101 },
  { symbol: "AAA", date: "2026-08-04", open: 100, high: 108, low: 92, close: 103 },
  { symbol: "AAA", date: "2026-08-05", open: 104, high: 120, low: 103, close: 116 },
  { symbol: "AAA", date: "2026-08-06", open: 105, high: 106, low: 97, close: 102 },
  { symbol: "AAA", date: "2026-08-07", open: 102, high: 107, low: 100, close: 106 },
];

test("cycle replay unifies candles, fill path, plans, excursions, and post-exit data", () => {
  const planHistory = [{ id: "plan-1", cycleId: cycle.id, accountId: "main", symbol: "AAA", field: "stopLoss", value: 94, reason: "跌破支撐", effectiveAt: "2026-08-03T14:00:00Z", createdAt: "2026-08-03T13:00:00Z" }];
  const replay = buildCycleReplay(cycle, bars, planHistory, {}, [{ previousCycleId: cycle.id, nextCycleId: "next", nextOpenAt: "2026-08-10T14:30:00Z", gapTradingDays: 2 }], {});
  assert.equal(replay.candles.length, 5);
  assert.equal(replay.postExitCount, 1);
  assert.deepEqual(replay.events.filter((event) => ["ENTRY", "ADD", "REDUCE", "EXIT"].includes(event.type)).map((event) => [event.type, event.afterQuantity]), [["ENTRY", 10], ["ADD", 15], ["REDUCE", 10], ["EXIT", 0]]);
  assert.equal(replay.events.find((event) => event.type === "PLAN_STOP").date, "2026-08-03");
  assert.equal(replay.events.find((event) => event.type === "MAE").date, "2026-08-04");
  assert.equal(replay.events.find((event) => event.type === "MFE").date, "2026-08-05");
  assert.equal(replay.events.find((event) => event.type === "RAPID_REPURCHASE").date, "2026-08-10");
});

test("replay window spans three calendar months before entry and after exit with daily volume context", () => {
  assert.deepEqual(replayWindowDates({ openAt: "2026-01-31T14:30:00Z", closeAt: "2026-02-28T14:30:00Z" }), { open: "2026-01-31", close: "2026-02-28", start: "2025-10-31", end: "2026-05-28" });
  const priorBars = Array.from({ length: 20 }, (_, index) => ({ symbol: "AAA", date: new Date(Date.UTC(2026, 4, 3 + index)).toISOString().slice(0, 10), open: 99, high: 101, low: 98, close: 100, volume: 100 + index }));
  const windowBars = [
    { symbol: "AAA", date: "2026-05-02", open: 99, high: 101, low: 98, close: 100, volume: 90 },
    ...priorBars,
    { symbol: "AAA", date: "2026-08-03", open: 100, high: 105, low: 94, close: 101, volume: 240 },
    { symbol: "AAA", date: "2026-08-06", open: 101, high: 104, low: 97, close: 102, volume: 180 },
    { symbol: "AAA", date: "2026-11-06", open: 103, high: 106, low: 101, close: 105, volume: 160 },
    { symbol: "AAA", date: "2026-11-07", open: 105, high: 106, low: 102, close: 103, volume: 170 },
  ];
  const replay = buildCycleReplay(cycle, windowBars);
  assert.equal(replay.windowStart, "2026-05-03");
  assert.equal(replay.windowEnd, "2026-11-06");
  assert.equal(replay.candles.at(0).date, "2026-05-03");
  assert.equal(replay.candles.at(-1).date, "2026-11-06");
  assert.equal(replay.candles.find((bar) => bar.date === "2026-08-03").phase, "HOLDING");
  assert.equal(replay.candles.find((bar) => bar.date === "2026-11-06").phase, "POST_EXIT");
  assert.ok(replay.candles.find((bar) => bar.date === "2026-08-03").averageVolume20 > 0);
  assert.ok(replay.candles.find((bar) => bar.date === "2026-08-03").volumeRatio > 1);
});

test("open position replay keeps entry, current stop, and three-month pre-entry context", () => {
  const position = { id: "cycle-open-1", accountId: "main", symbol: "AAA", market: "NASDAQ", currency: "USD", direction: "LONG", openAt: cycle.openAt, averageCost: 100, quantity: 10, fills: [cycle.fills[0]] };
  assert.deepEqual(openPositionWindowDates(position, "2026-08-26T12:00:00Z"), { open: "2026-08-03", close: "2026-08-26", start: "2026-05-03", end: "2026-08-26" });
  const replay = buildOpenPositionReplay(position, bars, [], { stopLoss: 94, takeProfit: 120, note: "跌破支撐", updatedAt: "2026-08-03T15:00:00Z" }, "2026-08-26T12:00:00Z");
  assert.equal(replay.status, "OPEN");
  assert.equal(replay.events.find((event) => event.type === "ENTRY").price, 100);
  assert.equal(replay.events.find((event) => event.type === "PLAN_STOP").price, 94);
  assert.equal(replay.events.find((event) => event.type === "PLAN_TARGET").price, 120);
  assert.equal(replay.postExitCount, 0);
});

test("year-month interval and display count filter closed cycles deterministically", () => {
  const cycles = [
    { ...cycle, id: "june", closeAt: "2026-06-20T00:00:00Z" },
    { ...cycle, id: "july", closeAt: "2026-07-20T00:00:00Z" },
    { ...cycle, id: "august", closeAt: "2026-08-20T00:00:00Z" },
  ];
  assert.deepEqual(filterCyclesByPeriod(cycles, "2026-07", "2026-08").map((item) => item.id), ["august", "july"]);
  assert.deepEqual(filterCyclesByPeriod(cycles, "", "", 2).map((item) => item.id), ["august", "july"]);
});

test("profit and loss stats support total, year, month, and week periods", () => {
  const winners = [{ ...cycle, id: "usd-win", pnl: 100, returnPct: 0.1, entryNotional: 1000, closeAt: "2026-08-06T14:30:00Z" }, { ...cycle, id: "twd-win", currency: "TWD", pnl: 3200, returnPct: 0.2, entryNotional: 32000, closeAt: "2026-08-07T14:30:00Z" }];
  const loser = { ...cycle, id: "usd-loss", pnl: -50, returnPct: -0.05, entryNotional: 500, closeAt: "2025-12-30T14:30:00Z" };
  const total = buildProfitLossTradeStats([...winners, loser], "all", "", 32);
  assert.equal(total.winners.count, 2);
  assert.ok(Math.abs(total.winners.averageReturn - 0.15) < 1e-12);
  assert.equal(total.winners.averagePnlUsd, 100);
  assert.equal(total.winners.averageEntryNotionalUsd, 1000);
  assert.equal(total.losers.averagePnlUsd, -50);
  assert.ok(Math.abs(total.winRate - (2 / 3)) < 1e-12);
  assert.ok(Math.abs(total.rewardRisk - 3) < 1e-12);
  assert.ok(Math.abs(total.expectancyR - (5 / 3)) < 1e-12);
  assert.equal(buildProfitLossTradeStats([...winners, loser], "year", "2026", 32).cycles.length, 2);
  assert.equal(buildProfitLossTradeStats([...winners, loser], "month", "2026-08", 32).cycles.length, 2);
  assert.equal(buildProfitLossTradeStats([...winners, loser], "week", "2026-08-03", 32).cycles.length, 2);
  assert.equal(cycleAnalysisPeriod(winners[0], "week"), "2026-08-03");
});

test("monthly expectancy trend follows closed cycles and keeps metric units separate", () => {
  const cycles = [
    { ...cycle, id: "jan-win", pnl: 100, returnPct: 0.2, closeAt: "2026-01-10T00:00:00Z" },
    { ...cycle, id: "jan-loss", pnl: -50, returnPct: -0.1, closeAt: "2026-01-20T00:00:00Z" },
    { ...cycle, id: "feb-win", pnl: 80, returnPct: 0.1, closeAt: "2026-02-10T00:00:00Z" },
  ];
  const trend = buildMonthlyExpectancyTrend(cycles);
  assert.deepEqual(trend.map((point) => point.month), ["2026-01", "2026-02"]);
  assert.equal(trend[0].winRate, 0.5);
  assert.equal(trend[0].rewardRisk, 2);
  assert.equal(trend[0].expectancyR, 0.5);
  assert.equal(trend[1].rewardRisk, null);
  assert.equal(trend[1].expectancyR, null);
});

test("mixed currency trade stats fail closed without FX", () => {
  const twd = { ...cycle, currency: "TWD", pnl: 3200, entryNotional: 32000 };
  const stats = buildProfitLossTradeStats([twd], "all", "", null);
  assert.equal(stats.winners.averagePnlUsd, null);
  assert.equal(stats.winners.averageEntryNotionalUsd, null);
  assert.equal(stats.winners.missingFx, true);
});

test("legacy stops remain visible without invented effective time", () => {
  const replay = buildCycleReplay(cycle, bars, [], { plannedStop: 95, invalidation: "跌破支撐" });
  const legacyStop = replay.events.find((event) => event.type === "PLAN_STOP");
  assert.equal(legacyStop.date, null);
  assert.equal(legacyStop.legacy, true);
  assert.match(legacyStop.detail, /時間不明/);
});

test("short replay classifies sell entries and buy exits", () => {
  const shortCycle = { ...cycle, id: "cycle-short", direction: "SHORT", fills: [{ id: "s", side: "SELL", quantity: 10, price: 100, timestamp: cycle.openAt }, { id: "b", side: "BUY", quantity: 10, price: 90, timestamp: cycle.closeAt }] };
  const replay = buildCycleReplay(shortCycle, bars);
  assert.deepEqual(replay.events.filter((event) => ["ENTRY", "EXIT"].includes(event.type)).map((event) => event.type), ["ENTRY", "EXIT"]);
});

test("behavior engine creates traceable deterministic findings and visual datasets", () => {
  const reviews = { [cycle.id]: { plannedStop: 95, revisedStop: 90, reflection: "回吐過多", updatedAt: "2026-08-07T00:00:00Z" } };
  const events = detectBehaviorEvents([cycle], bars, reviews, [], [], 32);
  assert.ok(events.some((event) => event.type === "MFE_GIVEBACK" && event.cycleId === cycle.id));
  assert.ok(events.some((event) => event.type === "LOSS_ADDING"));
  assert.ok(events.some((event) => event.type === "POST_HOC_PLAN"));
  const dashboard = buildBehaviorDashboard([cycle], bars, reviews, [], events);
  assert.equal(dashboard.retention[0].category, "LOW_CAPTURE");
  assert.equal(dashboard.maeReturn[0].cycleId, cycle.id);
  assert.equal(dashboard.funnel.at(-1).count, 1);
  assert.ok(dashboard.heatmap.length > 0);
});

test("trade quality analysis answers entry and exit quality with traceable price evidence", () => {
  const result = buildTradeQualityAnalysis([cycle], [
    ...bars,
    { symbol: "AAA", date: "2026-08-10", open: 106, high: 108, low: 104, close: 107 },
    { symbol: "AAA", date: "2026-08-11", open: 107, high: 109, low: 105, close: 108 },
    { symbol: "AAA", date: "2026-08-12", open: 108, high: 110, low: 106, close: 109 },
    { symbol: "AAA", date: "2026-08-13", open: 109, high: 111, low: 107, close: 110 },
  ], { [cycle.id]: { entryReview: "追價，應等回測", exitReview: "未依停利減碼", entryQualityTag: "LATE", exitQualityTag: "EARLY", qualityRatedAt: "2026-08-14T00:00:00Z" } });
  const trade = result.trades[0];
  assert.equal(trade.holdingLow, 92);
  assert.equal(trade.holdingHigh, 120);
  assert.ok(Math.abs(trade.entryScore - 20 / 28) < 1e-12);
  assert.ok(Math.abs(trade.exitScore - 10 / 28) < 1e-12);
  assert.ok(Math.abs(trade.entryFollowThrough3 - 0.02) < 1e-12);
  assert.ok(trade.postExit5 > 0.07);
  assert.equal(trade.entryReviewed, true);
  assert.equal(trade.exitReviewed, true);
  assert.equal(trade.entryQualityTag, "LATE");
  assert.equal(trade.exitQualityTag, "EARLY");
  assert.equal(trade.qualityRatedAt, "2026-08-14T00:00:00Z");
  assert.equal(result.summary.total, 1);
  assert.equal(result.tagAnalysis.entry.ratedCount, 1);
  assert.equal(result.tagAnalysis.fullyRatedCount, 1);
  assert.equal(result.weakestEntries[0].cycleId, cycle.id);
  assert.equal(result.weakestExits[0].cycleId, cycle.id);
});

test("short quality scores reward selling high and covering low", () => {
  const short = { ...cycle, id: "quality-short", direction: "SHORT", averageEntry: 118, averageExit: 94 };
  const result = buildTradeQualityAnalysis([short], bars);
  assert.ok(result.trades[0].entryScore > 0.9);
  assert.ok(result.trades[0].exitScore > 0.9);
});

test("coach caps findings at three and labels small samples as observation", () => {
  const events = ["MFE_GIVEBACK", "STOP_DELAY", "RAPID_REPURCHASE", "LOSS_ADDING"].map((type, index) => ({ type, cycleId: `c${index}`, date: `2026-08-${String(index + 1).padStart(2, "0")}`, impactUsd: 100 - index, severity: 2 }));
  const findings = buildCoachFindings(events);
  assert.equal(findings.length, 3);
  assert.ok(findings.every((finding) => finding.confidence === "待觀察"));
  assert.ok(findings[0].impactUsd >= findings[1].impactUsd);
});

test("improvement experiment preserves baseline and calculates subsequent compliance", () => {
  const finding = buildCoachFindings(Array.from({ length: 5 }, (_, index) => ({ type: "STOP_DELAY", cycleId: `old-${index}`, date: `2026-07-${String(index + 1).padStart(2, "0")}`, impactUsd: 20, severity: 3 })))[0];
  const experiment = createExperimentFromFinding(finding, new Date("2026-08-01T00:00:00Z"));
  const cycles = [{ ...cycle, id: "new-1", closeAt: "2026-08-05T00:00:00Z" }, { ...cycle, id: "new-2", closeAt: "2026-08-08T00:00:00Z" }];
  const result = evaluateExperiment(experiment, cycles, [{ type: "STOP_DELAY", cycleId: "new-1", date: "2026-08-05", impactUsd: 10 }], new Date("2026-08-10T00:00:00Z"));
  assert.equal(experiment.baseline.sampleCount, 5);
  assert.equal(result.violationRate, 0.5);
  assert.equal(result.rateChange, -0.5);
  assert.equal(result.impactUsd, 10);
});

test("KGC and WDC acceptance: short stop direction plus add/reduce replay remain explicit", () => {
  const kgc = {
    ...cycle,
    id: "kgc-short",
    symbol: "KGC",
    direction: "SHORT",
    averageEntry: 45.33,
    averageExit: 42.67,
    openAt: "2026-08-03T14:30:00Z",
    closeAt: "2026-08-10T14:30:00Z",
    fills: [
      { id: "kgc-s1", side: "SELL", quantity: 100, price: 45, timestamp: "2026-08-03T14:30:00Z" },
      { id: "kgc-s2", side: "SELL", quantity: 50, price: 46, timestamp: "2026-08-04T14:30:00Z" },
      { id: "kgc-b1", side: "BUY", quantity: 50, price: 44, timestamp: "2026-08-07T14:30:00Z" },
      { id: "kgc-b2", side: "BUY", quantity: 100, price: 42, timestamp: "2026-08-10T14:30:00Z" },
    ],
  };
  const kgcBars = [
    { symbol: "KGC", date: "2026-08-03", open: 45, high: 46, low: 44, close: 45 },
    { symbol: "KGC", date: "2026-08-04", open: 45, high: 47, low: 44, close: 46 },
    { symbol: "KGC", date: "2026-08-07", open: 44, high: 45, low: 42, close: 43 },
    { symbol: "KGC", date: "2026-08-10", open: 43, high: 44, low: 41, close: 42 },
  ];
  const history = [{ id: "kgc-stop", cycleId: kgc.id, accountId: "main", symbol: "KGC", field: "stopLoss", value: 48, effectiveAt: kgc.openAt, createdAt: kgc.openAt }];
  const replay = buildCycleReplay(kgc, kgcBars, history);
  assert.deepEqual(replay.events.filter((event) => ["ENTRY", "ADD", "REDUCE", "EXIT"].includes(event.type)).map((event) => event.type), ["ENTRY", "ADD", "REDUCE", "EXIT"]);
  assert.equal(replay.events.find((event) => event.type === "PLAN_STOP").price, 48);
  assert.ok(replay.events.find((event) => event.type === "MAE").price > kgc.averageEntry, "short MAE must be above entry");

  const wdc = { ...cycle, id: "wdc-long", symbol: "WDC", fills: cycle.fills.map((fill) => ({ ...fill, id: `wdc-${fill.id}` })) };
  const wdcReplay = buildCycleReplay(wdc, bars.map((bar) => ({ ...bar, symbol: "WDC" })));
  assert.deepEqual(wdcReplay.events.filter((event) => ["ENTRY", "ADD", "REDUCE", "EXIT"].includes(event.type)).map((event) => event.type), ["ENTRY", "ADD", "REDUCE", "EXIT"]);
});

test("AAOI and POET acceptance: MFE, giveback, and exit evidence include profitable and losing cycles", () => {
  const makeCycle = (symbol, id, exit, returnPct) => ({ ...cycle, id, symbol, averageEntry: 10, averageExit: exit, entryNotional: 1_000, quantity: 100, pnl: (exit - 10) * 100, returnPct, maePct: -0.1, mfePct: 0.5, fills: [{ id: `${id}-entry`, side: "BUY", quantity: 100, price: 10, timestamp: cycle.openAt }, { id: `${id}-exit`, side: "SELL", quantity: 100, price: exit, timestamp: cycle.closeAt }] });
  const aaoi = makeCycle("AAOI", "aaoi", 11, 0.1);
  const poet = makeCycle("POET", "poet", 9, -0.1);
  const excursionBars = [
    { date: "2026-08-03", open: 10, high: 11, low: 9, close: 10 },
    { date: "2026-08-04", open: 11, high: 15, low: 10, close: 14 },
    { date: "2026-08-06", open: 10, high: 11, low: 8, close: 9 },
  ];
  for (const candidate of [aaoi, poet]) {
    const candidateBars = excursionBars.map((bar) => ({ ...bar, symbol: candidate.symbol }));
    const replay = buildCycleReplay(candidate, candidateBars);
    assert.equal(replay.events.find((event) => event.type === "MFE").date, "2026-08-04");
    assert.equal(replay.events.find((event) => event.type === "EXIT").price, candidate.averageExit);
    const events = detectBehaviorEvents([candidate], candidateBars);
    assert.ok(events.some((event) => event.type === "MFE_GIVEBACK" && event.cycleId === candidate.id));
  }
});

test("NVTS acceptance: post-exit rapid repurchase links back to the decision chain", () => {
  const previous = { ...cycle, id: "nvts-first", symbol: "NVTS" };
  const pair = { previousCycleId: previous.id, nextCycleId: "nvts-second", nextOpenAt: "2026-08-10T14:30:00Z", gapTradingDays: 2 };
  const replay = buildCycleReplay(previous, bars.map((bar) => ({ ...bar, symbol: "NVTS" })), [], {}, [pair], { "nvts-first>nvts-second": { linked: true } });
  const event = replay.events.find((candidate) => candidate.type === "RAPID_REPURCHASE");
  assert.equal(event.date, "2026-08-10");
  assert.match(event.detail, /已連結決策鏈/);
});
