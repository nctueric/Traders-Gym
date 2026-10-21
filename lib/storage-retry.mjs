export const BACKGROUND_SAVE_MS = 600_000;
export function d1LimitError(error, now = Date.now()) {
 const message = String(error?.message || error);
 if (!/D1/i.test(message) || !/(exceeded.*(?:daily|free tier)|(?:daily|free tier).*exceeded|daily.*limit.*(?:reached|exceeded))/i.test(message)) return null;
 const day = new Date(now); day.setUTCHours(24,0,0,0);
 return { error: 'D1 每日額度已用盡，修改保留於本機後等待同步', code: 'D1_DAILY_LIMIT', retryAt: day.toISOString() };
}
export function storageRetryDelay(error, attempt, now = Date.now(), random = Math.random()) {
 if (error?.code === 'D1_DAILY_LIMIT' && Number.isFinite(Date.parse(error.retryAt))) return Math.max(0, Date.parse(error.retryAt)-now);
 return Math.min(BACKGROUND_SAVE_MS, 30_000 * 2 ** Math.min(attempt, 5)) * (0.9 + 0.1 * random);
}
export function logLedgerWrites(kind, results, operations) {
 const entries = Array.isArray(results) ? results : [results];
 console.log('ledger-storage', JSON.stringify({kind, operations, rowsWritten: entries.reduce((n,r)=>n+(r?.meta?.rows_written||0),0), rowsRead: entries.reduce((n,r)=>n+(r?.meta?.rows_read||0),0)}));
}
