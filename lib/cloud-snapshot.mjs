import { buildCycles } from './trade-engine.mjs';
import { completeTradeDataset } from './trade-record-store.mjs';
import { buildDashboardSummary } from './snapshot-performance.mjs';

const FX_SYMBOLS = new Set(['USDTWD', 'USDTWD=X']);

function holdingWindows(fills) {
  const { cycles, positions } = buildCycles({ fills: fills || [], marketBars: [] });
  const bySymbol = new Map();
  for (const item of [...cycles, ...positions]) {
    const start = String(item.openAt || '').slice(0, 10);
    const end = item.closeAt ? String(item.closeAt).slice(0, 10) : '9999-12-31';
    if (!item.symbol || !start) continue;
    const rows = bySymbol.get(item.symbol) || [];
    rows.push([start, end]);
    bySymbol.set(item.symbol, rows);
  }
  for (const [symbol, rows] of bySymbol) {
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    const merged = [];
    for (const row of rows) {
      const current = merged.at(-1);
      if (current && row[0] <= current[1]) current[1] = current[1] > row[1] ? current[1] : row[1];
      else merged.push([...row]);
    }
    bySymbol.set(symbol, merged);
  }
  return bySymbol;
}

// Cloud snapshots retain every user-authored field plus the bars required for
// portfolio valuation and in-position MAE/MFE. Wider replay context is a
// refreshable cache and is fetched again in the background when needed.
/** @param {any} dataset @param {any} [performanceCache] */
export function compactCloudSnapshot(dataset, performanceCache = null, now = null) {
  const complete = completeTradeDataset(dataset);
  const windows = holdingWindows(complete.fills);
  const marketBars = (complete.marketBars || []).filter(bar => {
    if (FX_SYMBOLS.has(bar?.symbol)) return true;
    if (!bar?.date) return false;
    return (windows.get(bar.symbol) || []).some(([start, end]) => bar.date >= start && bar.date <= end);
  });
  const marketSnapshot = complete.marketSnapshot ? { ...complete.marketSnapshot } : undefined;
  // Coverage outside the compacted holding windows must be fetched again.
  if (marketSnapshot && Object.hasOwn(marketSnapshot, 'ohlcCoverage')) marketSnapshot.ohlcCoverage = [];
  const compact = { ...complete, marketBars, ...(marketSnapshot ? { marketSnapshot } : {}) };
  const lastQuoteAt = Number(compact.marketSnapshot?.lastQuoteAt);
  const summaryTime = now || (Number.isFinite(lastQuoteAt) && lastQuoteAt > 0 ? new Date(lastQuoteAt) : new Date(0));
  return { ...compact, dashboardSummary: buildDashboardSummary(compact, performanceCache, summaryTime) };
}
