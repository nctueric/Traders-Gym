export const REVIEW_STEPS = [
  { id: "facts", label: "發生什麼" },
  { id: "judgment", label: "我的判斷" },
  { id: "reason", label: "原因" },
  { id: "experiment", label: "改善實驗" },
];

export function cycleReviewProgress(review = {}) {
  const complete = {
    facts: true,
    judgment: Boolean(review.entryQualityTag && review.exitQualityTag),
    reason: Boolean(String(review.exitReason || "").trim()),
    experiment: Boolean(String(review.reflection || "").trim()),
  };
  const firstIncomplete = REVIEW_STEPS.findIndex((step) => !complete[step.id]);
  return {
    steps: REVIEW_STEPS.map((step) => ({ ...step, complete: complete[step.id] })),
    completedCount: Object.values(complete).filter(Boolean).length,
    complete: Object.values(complete).every(Boolean),
    nextIncompleteIndex: firstIncomplete < 0 ? REVIEW_STEPS.length - 1 : firstIncomplete,
  };
}
