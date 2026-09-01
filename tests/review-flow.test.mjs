import test from "node:test";
import assert from "node:assert/strict";
import { cycleReviewProgress, REVIEW_STEPS } from "../lib/review-flow.mjs";

test("review flow opens the first incomplete human step and keeps four fixed stages", () => {
  const progress = cycleReviewProgress({ entryQualityTag: "IDEAL", exitQualityTag: "EARLY" });
  assert.deepEqual(REVIEW_STEPS.map((step) => step.id), ["facts", "judgment", "reason", "experiment"]);
  assert.equal(progress.nextIncompleteIndex, 2);
  assert.equal(progress.completedCount, 2);
  assert.equal(progress.complete, false);
});

test("review flow is complete only after judgment, reason and experiment exist", () => {
  const progress = cycleReviewProgress({ entryQualityTag: "LATE", exitQualityTag: "IDEAL", exitReason: "達到目標", reflection: "下五筆只在回測確認後進場" });
  assert.equal(progress.completedCount, 4);
  assert.equal(progress.complete, true);
});
