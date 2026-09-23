import { normalizeEntryQualityTag, normalizeExitQualityTag } from "./quality-rating.mjs";

export function cycleReviewProgress(review = {}) {
  const entryComplete = Boolean(normalizeEntryQualityTag(review.entryQualityTag));
  const exitComplete = Boolean(normalizeExitQualityTag(review.exitQualityTag));
  return { completedCount: Number(entryComplete) + Number(exitComplete), complete: entryComplete && exitComplete };
}
