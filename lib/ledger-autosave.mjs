import { canRefreshCloudRecord } from './trade-record-client.mjs';

export const EDIT_SAVE_DELAY_MS = 2000;

// Only durable edits schedule a write. Quotes are intentionally not a dependency.
export function scheduleLedgerAutosave({ serialized, baselineJson, save, blocked = false,
  schedule = setTimeout, cancel = clearTimeout }) {
  if (blocked || canRefreshCloudRecord(serialized, baselineJson)) return () => {};
  const timer = schedule(save, EDIT_SAVE_DELAY_MS);
  return () => cancel(timer);
}

export function isCurrentCheckpoint(captured, current, baseline, currentBaseline) {
  return captured.accountId === current.accountId && captured.serialized === current.serialized
    && baseline === currentBaseline;
}
