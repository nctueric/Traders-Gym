import { mergeHistoryCoverage } from "./history-coverage.mjs";
import { completeTradeDataset, durableTradeJson } from "./trade-record-store.mjs";
import { mergeMarketBars } from "./quote-engine.mjs";

export function buildTradeSnapshot(dataset, { quotes, lastQuoteAt, benchmarkBars, benchmarkSymbol }) {
  return {
    ...completeTradeDataset(dataset),
    marketSnapshot: {
      ...dataset.marketSnapshot,
      version: 1,
      quotes,
      lastQuoteAt,
      benchmarkSymbol,
      benchmarkBars,
    },
  };
}

export function restoreMarketSnapshot(dataset) {
  const saved = dataset.marketSnapshot || {};
  const benchmarkSymbol = dataset.settings?.benchmarkSymbol || "SPY";
  return {
    quotes: saved.quotes && typeof saved.quotes === "object" && !Array.isArray(saved.quotes) ? saved.quotes : {},
    lastQuoteAt: Number.isFinite(saved.lastQuoteAt) ? saved.lastQuoteAt : null,
    benchmarkSymbol,
    benchmarkBars: saved.benchmarkSymbol === benchmarkSymbol && Array.isArray(saved.benchmarkBars) ? saved.benchmarkBars : [],
  };
}

// Only reconcile refreshable evidence. Never combine independently edited plans or ledgers.
export function mergeSnapshotEvidence(preferred, other) {
  const a = preferred.marketSnapshot || {}, b = other.marketSnapshot || {};
  const quotes = { ...b.quotes, ...a.quotes };
  for (const [symbol, quote] of Object.entries(b.quotes || {})) {
    if (!quotes[symbol] || Date.parse(quote.updatedAt) > Date.parse(quotes[symbol].updatedAt)) quotes[symbol] = quote;
  }
  const symbol = preferred.settings?.benchmarkSymbol || "SPY";
  const newer = (a.lastQuoteAt || 0) >= (b.lastQuoteAt || 0) ? a : b;
  const older = newer === a ? b : a;
  const marketSnapshot = a.version || b.version || a.quotes || b.quotes ? {
    ...b, ...a, version: 1, quotes,
    ...((a.ohlcCoverage || b.ohlcCoverage) ? {ohlcCoverage: mergeHistoryCoverage(b.ohlcCoverage || [], a.ohlcCoverage || [])} : {}),
    lastQuoteAt: Math.max(a.lastQuoteAt || 0, b.lastQuoteAt || 0) || null,
    benchmarkSymbol: symbol,
    benchmarkBars: mergeMarketBars(older.benchmarkSymbol === symbol ? older.benchmarkBars : [], newer.benchmarkSymbol === symbol ? newer.benchmarkBars : []),
  } : undefined;
  return {
    ...completeTradeDataset(preferred),
    marketBars: mergeMarketBars(other.marketBars, preferred.marketBars),
    ...(marketSnapshot ? { marketSnapshot } : {}),
  };
}

export function reconcileTradeSnapshots(local, server, baselineJson) {
  const localLedger = durableTradeJson(local), serverLedger = durableTradeJson(server);
  const baseline = baselineJson ? durableTradeJson(JSON.parse(baselineJson)) : null;
  if (serverLedger === localLedger || serverLedger === baseline) return mergeSnapshotEvidence(local, server);
  if (localLedger === baseline) return mergeSnapshotEvidence(server, local);
  return null;
}
