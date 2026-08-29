import test from "node:test";
import assert from "node:assert/strict";
import { buildCoachBrief, isCycleReviewPending } from "../lib/coach-brief.mjs";

const position = { id: "open-1", symbol: "AAA", currency: "USD", direction: "LONG", quantity: 10 };

test("coach brief enforces data, risk, review order and caps output at three", () => {
  const brief = buildCoachBrief({
    issues: [{ level: "error", code: "INVALID_FILL", message: "成交資料無效" }],
    qualityPct: 80,
    positionRows: [{ position, plan: { stopLoss: 95 }, metrics: { stopBreached: true, stopLossAmountUsd: 50 } }],
    cycles: [{ id: "cycle-1", symbol: "AAA", closeAt: "2026-08-20T00:00:00Z", pnl: -20, currency: "USD" }],
    reviews: {},
    findings: [{ type: "STOP_DELAY", title: "停損延遲", description: "延遲執行", sampleCount: 8, impactUsd: 100 }],
  });
  assert.deepEqual(brief.map((item) => item.kind), ["DATA", "RISK", "REVIEW"]);
  assert.equal(brief.length, 3);
  assert.equal(brief[0].confidence, "FACT");
  assert.equal(brief[1].nextAction.entityId, position.id);
});

test("coach brief uses a behavior finding only after cycle reviews are complete", () => {
  const reviews = { done: { entryQualityTag: "IDEAL", exitQualityTag: "IDEAL", reflection: "維持等待訊號" } };
  const brief = buildCoachBrief({
    cycles: [{ id: "done", symbol: "AAA", closeAt: "2026-08-20T00:00:00Z" }],
    reviews,
    findings: [{ type: "STOP_DELAY", title: "停損延遲", description: "有重複延遲", sampleCount: 5, impactUsd: 80, evidenceCycleIds: ["done"], trend: "持平" }],
  });
  assert.equal(brief[0].kind, "BEHAVIOR");
  assert.equal(brief[0].confidence, "PATTERN");
  assert.equal(isCycleReviewPending(reviews.done), false);
});

test("coach brief returns a positive maintenance state when no action is pending", () => {
  const brief = buildCoachBrief();
  assert.equal(brief.length, 1);
  assert.equal(brief[0].kind, "POSITIVE");
  assert.equal(brief[0].nextAction.target, "performance");
});
