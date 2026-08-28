import assert from "node:assert/strict";
import test from "node:test";
import { buildQualityTagAnalysis, exitQualityGroup, normalizeEntryQualityTag, normalizeExitQualityTag, updateQualityRating } from "../lib/quality-rating.mjs";
import { serializeInBackground } from "../lib/background-serializer.mjs";
import { validateTradeRecordPayload } from "../lib/trade-record-store.mjs";
import { buildTradeQualityAnalysis, cycleAnalysisPeriod, filterCyclesByPeriod } from "../lib/coach-engine.mjs";

const cycles = [
  { id: "win", pnl: 100 },
  { id: "loss", pnl: -50 },
  { id: "flat", pnl: 0 },
  { id: "pending", pnl: 25 },
];

test("quality tags reject values outside the fixed single-choice taxonomy", () => {
  assert.equal(normalizeEntryQualityTag("IDEAL"), "IDEAL");
  assert.equal(normalizeEntryQualityTag("MULTIPLE"), null);
  assert.equal(normalizeExitQualityTag("WRONG_ENTRY"), null);
});

test("profit, loss, and breakeven cycles use the requested exit groups", () => {
  assert.equal(exitQualityGroup(cycles[0]), "PROFIT_EXIT");
  assert.equal(exitQualityGroup(cycles[1]), "STOP_EXIT");
  assert.equal(exitQualityGroup(cycles[2]), "STOP_EXIT");
});

test("unrated cycles stay outside percentage denominators and inside coverage", () => {
  const result = buildQualityTagAnalysis(cycles, {
    win: { entryQualityTag: "IDEAL", exitQualityTag: "EARLY" },
    loss: { entryQualityTag: "LATE", exitQualityTag: "IDEAL" },
    flat: { entryQualityTag: "WRONG_ENTRY", exitQualityTag: "LATE" },
  });
  assert.equal(result.entry.applicableCount, 4);
  assert.equal(result.entry.ratedCount, 3);
  assert.equal(result.entry.pendingCount, 1);
  assert.equal(result.entry.coverage, 0.75);
  assert.equal(result.profitExit.applicableCount, 2);
  assert.equal(result.profitExit.ratedCount, 1);
  assert.equal(result.stopExit.applicableCount, 2);
  assert.equal(result.stopExit.ratedCount, 2);
  assert.equal(result.fullyRatedCount, 3);
});

test("rated label percentages sum to one while empty groups expose no fake rate", () => {
  const rated = buildQualityTagAnalysis(cycles.slice(0, 3), {
    win: { entryQualityTag: "IDEAL", exitQualityTag: "EARLY" },
    loss: { entryQualityTag: "IDEAL", exitQualityTag: "IDEAL" },
    flat: { entryQualityTag: "EARLY", exitQualityTag: "LATE" },
  });
  assert.equal(rated.entry.items.reduce((sum, item) => sum + item.rate, 0), 1);
  assert.equal(rated.stopExit.items.reduce((sum, item) => sum + item.rate, 0), 1);
  const empty = buildQualityTagAnalysis(cycles, {});
  assert.ok(empty.entry.items.every((item) => item.rate == null));
  assert.equal(empty.entry.sampleState, "OBSERVING");
});

test("display percentages sum to 100.0 even with repeating fractions", () => {
  const result = buildQualityTagAnalysis(cycles.slice(0, 3), {
    win: { entryQualityTag: "EARLY" }, loss: { entryQualityTag: "LATE" }, flat: { entryQualityTag: "IDEAL" },
  });
  assert.deepEqual(result.entry.items.map((item) => item.percentage), [33.4, 33.3, 33.3, 0]);
  assert.equal(Math.round(result.entry.items.reduce((sum, item) => sum + item.percentage, 0) * 10), 1000);
  assert.ok(buildQualityTagAnalysis([]).entry.items.every((item) => item.percentage === null));
});

test("single selection replaces only its field and retains notes and other rating", () => {
  const original = { entryQualityTag: "EARLY", exitQualityTag: "IDEAL", entryReview: "原計畫證據", exitReview: "按停損退出", plannedStop: 50 };
  const changed = updateQualityRating(original, "entryQualityTag", "LATE", "2026-08-28T00:00:00Z");
  assert.equal(changed.entryQualityTag, "LATE");
  assert.equal(changed.exitQualityTag, "IDEAL");
  assert.equal(changed.entryReview, original.entryReview);
  assert.equal(changed.plannedStop, 50);
  assert.equal(changed.qualityRatedAt, "2026-08-28T00:00:00Z");
  assert.equal(changed.updatedAt, changed.qualityRatedAt);
  assert.equal(original.entryQualityTag, "EARLY");
  assert.throws(() => updateQualityRating(original, "exitQualityTag", "WRONG_ENTRY"));
});

test("account JSON and background serialization preserve manual ratings and timestamp", async () => {
  const review = updateQualityRating({}, "entryQualityTag", "WRONG_ENTRY", "2026-08-28T00:00:00Z");
  const dataset = { profile: { name: "QA" }, accounts: [], fills: [], marketBars: [], settings: {}, cycleReviews: { win: review } };
  const serialized = await serializeInBackground(dataset, undefined);
  const checked = validateTradeRecordPayload({ accountId: "qa", accountName: "QA", dataset: JSON.parse(serialized), baseVersion: 7 });
  assert.equal(checked.ok, true);
  assert.deepEqual(JSON.parse(checked.datasetJson).cycleReviews.win, review);
  assert.equal(checked.baseVersion, 7);
});

test("legacy scores and notes cannot infer tags; shorts and mixed currencies without prices remain rateable", () => {
  const sample = [{ id: "usd", pnl: 20, currency: "USD", direction: "SHORT", openAt: "2026-08-01", closeAt: "2026-08-02", fills: [] },
    { id: "twd", pnl: -1000, currency: "TWD", direction: "LONG", openAt: "2026-08-01", closeAt: "2026-08-03", fills: [] }];
  const old = buildTradeQualityAnalysis(sample, [], { usd: { entryReview: "完美", entryScore: 1 } });
  assert.equal(old.tagAnalysis.entry.ratedCount, 0);
  assert.ok(old.trades.every((trade) => trade.entryQualityTag === null));
  const rated = buildTradeQualityAnalysis(sample, [], { usd: { entryQualityTag: "IDEAL", exitQualityTag: "EARLY" }, twd: { entryQualityTag: "LATE", exitQualityTag: "IDEAL" } });
  assert.equal(rated.tagAnalysis.fullyRatedCount, 2);
  assert.equal(rated.tagAnalysis.profitExit.items[0].cycleIds[0], "usd");
  assert.equal(rated.tagAnalysis.stopExit.items[2].cycleIds[0], "twd");
});

test("period, strategy-version, and display-count subsets use only matching quality samples", () => {
  const sample = [
    { id: "a", pnl: 1, closeAt: "2025-08-01T00:00:00Z" },
    { id: "b", pnl: -1, closeAt: "2026-08-03T00:00:00Z" },
    { id: "c", pnl: 2, closeAt: "2026-08-04T00:00:00Z" },
    { id: "d", pnl: 3, closeAt: "2026-08-17T00:00:00Z" },
  ];
  const reviews = Object.fromEntries(sample.map((cycle) => [cycle.id, { entryQualityTag: "IDEAL", exitQualityTag: "EARLY" }]));
  for (const [scope, period, count] of [["all", "", 4], ["year", "2026", 3], ["month", "2026-08", 3], ["week", "2026-08-03", 2]]) {
    const subset = sample.filter((cycle) => scope === "all" || cycleAnalysisPeriod(cycle, scope) === period);
    assert.equal(buildQualityTagAnalysis(subset, reviews).entry.ratedCount, count);
  }
  const assignments = { a: { strategyId: "s", strategyVersionId: "v1" }, b: { strategyId: "s", strategyVersionId: "v2" }, c: { strategyId: "s", strategyVersionId: "v2" } };
  const subset = sample.filter((cycle) => assignments[cycle.id]?.strategyId === "s" && assignments[cycle.id]?.strategyVersionId === "v2");
  assert.equal(buildQualityTagAnalysis(subset, reviews).entry.ratedCount, 2);
  const latest = filterCyclesByPeriod(subset, "", "", 1);
  assert.deepEqual(buildQualityTagAnalysis(latest, reviews).entry.items[2].cycleIds, ["c"]);
});

test("20-rating threshold depends on rated samples, not unreviewed trades", () => {
  const sample = Array.from({ length: 21 }, (_, i) => ({ id: String(i), pnl: 1 }));
  const reviews = Object.fromEntries(sample.slice(0, 19).map((cycle) => [cycle.id, { entryQualityTag: "IDEAL" }]));
  assert.equal(buildQualityTagAnalysis(sample, reviews).entry.sampleState, "OBSERVING");
  reviews["19"] = { entryQualityTag: "IDEAL" };
  assert.equal(buildQualityTagAnalysis(sample, reviews).entry.sampleState, "ESTABLISHED");
});
