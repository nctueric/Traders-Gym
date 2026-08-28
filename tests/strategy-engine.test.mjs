import test from "node:test";
import assert from "node:assert/strict";
import { buildStrategyAnalysis, createStrategy, createStrategyAssignment, normalizeStrategyDataset, publishStrategyVersion, ruleApplies, strategyReplayEvents, updateStrategyCheck } from "../lib/strategy-engine.mjs";

const baseCycle = { id: "cycle-a", accountId: "main", symbol: "AAA", currency: "USD", direction: "LONG", openAt: "2026-08-01T00:00:00Z", closeAt: "2026-08-10T00:00:00Z", pnl: 100, returnPct: 0.1, entryNotional: 1000 };
const rules = [
  { id: "market", group: "MARKET_CONDITION", name: "量能", criterion: "成交量大於20日均量", checkpoint: "BEFORE_ENTRY", appliesWhen: "ALWAYS" },
  { id: "entry", group: "ENTRY_TRIGGER", name: "突破", criterion: "收盤突破前高", checkpoint: "AT_ENTRY", appliesWhen: "ALWAYS" },
  { id: "winner-exit", group: "EXIT_TRIGGER", name: "獲利保護", criterion: "跌破10日線出場", checkpoint: "AT_EXIT", appliesWhen: "WINNING_POSITION" },
  { id: "loser-exit", group: "EXIT_TRIGGER", name: "停損", criterion: "跌破停損價出場", checkpoint: "AT_EXIT", appliesWhen: "LOSING_POSITION" },
];

function activeStrategy() {
  const draft = createStrategy({ name: "波段突破", rules }, "2026-07-01T00:00:00Z");
  return publishStrategyVersion(draft, rules, "首次啟用", "2026-07-02T00:00:00Z").strategy;
}

test("legacy datasets receive empty strategy containers", () => {
  assert.deepEqual(normalizeStrategyDataset({ fills: [] }).strategies, []);
  assert.deepEqual(normalizeStrategyDataset({ fills: [] }).strategyAssignments, {});
});

test("published strategy versions are immutable snapshots", () => {
  const first = activeStrategy();
  const second = publishStrategyVersion(first, [{ ...rules[0], criterion: "成交量大於50萬" }], "提高量能門檻", "2026-08-01T00:00:00Z").strategy;
  assert.equal(second.versions.length, 2);
  assert.equal(second.versions[0].rules[0].criterion, "成交量大於20日均量");
  assert.equal(second.versions[1].rules[0].criterion, "成交量大於50萬");
});

test("assignment keeps one active version and flags late historical work", () => {
  const assignment = createStrategyAssignment(baseCycle, activeStrategy(), "HISTORICAL_BATCH", "2026-08-20T00:00:00Z");
  assert.equal(assignment.strategyVersionId.endsWith("v1"), true);
  assert.equal(assignment.lateAssignment, true);
  assert.equal(assignment.preChecks.market.status, "UNREVIEWED");
});

test("winner and loser exit rules apply deterministically", () => {
  assert.equal(ruleApplies(rules[2], baseCycle), true);
  assert.equal(ruleApplies(rules[3], baseCycle), false);
  assert.equal(ruleApplies(rules[3], { ...baseCycle, pnl: -10 }), true);
});

test("unreviewed checks stay outside adherence while reviewed violations remain traceable", () => {
  const strategy = activeStrategy();
  let assignment = createStrategyAssignment(baseCycle, strategy, "PRE_TRADE", "2026-07-31T00:00:00Z");
  assignment = updateStrategyCheck(assignment, "post", "market", "FOLLOWED", "量能符合", "2026-08-11T00:00:00Z");
  assignment = updateStrategyCheck(assignment, "post", "entry", "VIOLATED", "追價", "2026-08-11T00:00:00Z");
  assignment = updateStrategyCheck(assignment, "post", "winner-exit", "FOLLOWED", "依線出場", "2026-08-11T00:00:00Z");
  const analysis = buildStrategyAnalysis([baseCycle], [strategy], { [baseCycle.id]: assignment }, { usdTwdRate: 32 });
  assert.equal(analysis.adherenceRate, 2 / 3);
  assert.equal(analysis.reviewedTradeCount, 1);
  assert.equal(analysis.violated.count, 1);
  assert.equal(analysis.sampleState, "OBSERVING");
  assert.deepEqual(analysis.rules.find((rule) => rule.ruleId === "entry").evidenceCycleIds, [baseCycle.id]);
  assert.ok(strategyReplayEvents(baseCycle, [strategy], { [baseCycle.id]: assignment }).some((event) => event.type === "RULE_VIOLATED"));
});
