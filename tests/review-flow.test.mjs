import test from "node:test";
import assert from "node:assert/strict";
import { cycleReviewProgress } from "../lib/review-flow.mjs";
import { updateQualityRating, buildQualityTagAnalysis } from "../lib/quality-rating.mjs";

test("two valid judgments complete review without reasons, experiments or strategy audit", () => {
  assert.deepEqual(cycleReviewProgress({}), { completedCount: 0, complete: false });
  assert.deepEqual(cycleReviewProgress({ entryQualityTag: "IDEAL" }), { completedCount: 1, complete: false });
  assert.deepEqual(cycleReviewProgress({ entryQualityTag: "IDEAL", exitQualityTag: "EARLY" }), { completedCount: 2, complete: true });
  assert.equal(cycleReviewProgress({ entryQualityTag: "invalid", exitQualityTag: "WRONG_ENTRY", exitReason: "reason", reflection: "experiment" }).complete, false);
});

test("changing and clearing judgments preserve legacy evidence and update coverage", () => {
  const old = { entryQualityTag: "LATE", exitQualityTag: "IDEAL", entryReview: "entry note", exitReview: "exit note", exitReason: "target", reflection: "experiment", plannedStop: 25, revisedStop: 23, tags: "breakout" };
  const changed = updateQualityRating(old, "entryQualityTag", "EARLY", "2026-09-17T00:00:00Z");
  for (const field of ["entryReview", "exitReview", "exitReason", "reflection", "plannedStop", "revisedStop", "tags"]) assert.deepEqual(changed[field], old[field]);
  assert.equal(cycleReviewProgress(changed).complete, true);
  const cleared = updateQualityRating(changed, "exitQualityTag", "", "2026-09-17T01:00:00Z");
  assert.equal(cleared.exitQualityTag, null);
  assert.equal(cycleReviewProgress(cleared).complete, false);
  assert.equal(old.exitQualityTag, "IDEAL");
  assert.equal(buildQualityTagAnalysis([{ id: "cycle", pnl: 100 }], { cycle: cleared }).fullyRatedCount, 0);
  assert.throws(() => updateQualityRating(old, "exitQualityTag", "WRONG_ENTRY"));
});
