// Derived values only. This fingerprint intentionally excludes quotes, notes and ratings.
export const REVIEW_CACHE_VERSION = 1;
export async function reviewCacheKey(data, cycles) {
  const source = JSON.stringify({ version: REVIEW_CACHE_VERSION, accounts: data.accounts, fills: data.fills, cash: data.cashActivities, bars: data.marketBars, cycles: cycles.map(c => [c.id, c.pnl, c.entryNotional, c.mfePct]) });
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))), n => n.toString(16).padStart(2, '0')).join('');
}
export function scopedReviewMetrics(rows, cycles) {
  const losses = cycles.filter(c => c.pnl < 0 && c.entryNotional > 0).map(c => c.pnl / c.entryNotional).filter(Number.isFinite);
  const averageLoss = losses.length ? Math.abs(losses.reduce((a,b) => a+b,0)/losses.length) : null;
  return { rows: Object.fromEntries(Object.entries(rows).map(([id,r]) => [id,{...r,expectancy: averageLoss > 0 && r.returnPct != null ? r.returnPct / averageLoss : null}])), averageLoss, lossCount: losses.length };
}
export function validReviewCache(value, key) {
  const numeric = n => n === null || typeof n === 'number' && Number.isFinite(n);
  const strings = a => Array.isArray(a) && a.every(s => typeof s === 'string');
  return !!value && value.version === REVIEW_CACHE_VERSION && value.key === key && typeof value.savedAt === 'string' && Number.isFinite(Date.parse(value.savedAt)) && value.rows && typeof value.rows === 'object' && !Array.isArray(value.rows) && Object.values(value.rows).every(r => r && typeof r === 'object' &&
    ['pnl','invested','returnPct','investedUsd','allocation','mfePct','holdingTradingDays'].every(k => numeric(r[k])) && ['USD','TWD'].includes(r.currency) && r.equity && numeric(r.equity.total) && (r.equity.date === null || typeof r.equity.date === 'string') && strings(r.equity.problems) && strings(r.equity.warnings) && strings(r.investmentProblems) && Array.isArray(r.equity.prices) && r.equity.prices.every(p => typeof p.symbol === 'string' && typeof p.date === 'string' && numeric(p.close)) && Array.isArray(r.equity.fxHistory) && r.equity.fxHistory.every(f => typeof f.date === 'string' && numeric(f.rate)));
}
