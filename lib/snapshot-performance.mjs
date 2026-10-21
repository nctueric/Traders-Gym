import { buildCurrentEquity } from './portfolio-engine.mjs';
import { buildMonthlyAssetPoint } from './monthly-assets.mjs';
import { restoreMarketSnapshot } from './trade-snapshot.mjs';
import { summarize } from './trade-engine.mjs';
import { convertCurrency, currencyTotal } from './valuation.mjs';
import { historicalMonths, overviewPeriodValuation, realizedValue } from './valuation-reports.mjs';
import { toProviderSymbol, USDTWD_SYMBOL } from './quote-engine.mjs';

const validBar = bar => bar?.date && Number.isFinite(Number(bar.close)) && Number(bar.close) > 0;

function entry(bars) {
  const rows = [...new Map(bars.filter(validBar).map(bar => [bar.date, { date: bar.date, close: Number(bar.close) }])).values()]
    .sort((a, b) => a.date.localeCompare(b.date));
  return { bars: rows, coverage: [] };
}

// The verified cloud snapshot is an immediate, offline-safe performance cache.
// Background downloads can extend or replace these prices without blanking UI.
export function performanceCacheFromSnapshot(dataset) {
  const providers = new Map((dataset.fills || []).map(fill => [fill.symbol, toProviderSymbol(fill.symbol, fill.market || fill.exchange)]));
  const grouped = new Map();
  for (const bar of dataset.marketBars || []) {
    if (!validBar(bar)) continue;
    const symbol = ['USDTWD', USDTWD_SYMBOL].includes(bar.symbol) ? USDTWD_SYMBOL : (providers.get(bar.symbol) || bar.symbol);
    const key = `${symbol}:raw`;
    const rows = grouped.get(key) || [];
    rows.push(bar);
    grouped.set(key, rows);
  }
  const snapshot = restoreMarketSnapshot(dataset);
  if (snapshot.benchmarkBars.length) grouped.set(`${snapshot.benchmarkSymbol}:adjusted`, snapshot.benchmarkBars);
  return { version: 1, entries: Object.fromEntries([...grouped].map(([key, bars]) => [key, entry(bars)])) };
}

export function mergePerformanceCaches(base, update) {
  const entries = {};
  for (const key of new Set([...Object.keys(base?.entries || {}), ...Object.keys(update?.entries || {})])) {
    const older = base?.entries?.[key] || { bars: [], coverage: [] };
    const newer = update?.entries?.[key] || { bars: [], coverage: [] };
    entries[key] = {
      bars: [...new Map([...(older.bars || []), ...(newer.bars || [])].filter(validBar).map(bar => [bar.date, bar])).values()].sort((a, b) => a.date.localeCompare(b.date)),
      coverage: [...(older.coverage || []), ...(newer.coverage || [])],
    };
  }
  return { version: 1, entries };
}

function endOfMonth(month, now) {
  if (month === now.toISOString().slice(0, 7)) return now;
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0, 23, 59, 59, 999));
}

export function snapshotMonthComparisons(dataset, now, currency, fx) {
  const dates = [...(dataset.fills || []), ...(dataset.cashActivities || [])].map(row => String(row.timestamp || '').slice(0, 7)).filter(month => /^\d{4}-\d{2}$/.test(month));
  if (!dates.length) return [];
  const current = now.toISOString().slice(0, 7), months = [];
  const cursor = new Date(`${dates.sort()[0]}-01T00:00:00Z`);
  while (cursor.toISOString().slice(0, 7) <= current) { months.push(cursor.toISOString().slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
  const benchmark = restoreMarketSnapshot(dataset).benchmarkBars.filter(validBar).sort((a, b) => a.date.localeCompare(b.date));
  const latest = date => [...benchmark].reverse().find(bar => bar.date <= date)?.close ?? null;
  return months.slice(-3).map(month => {
    const end = endOfMonth(month, now), point = buildMonthlyAssetPoint(dataset, month, fx, {}, now, end);
    const previousMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 0)).toISOString().slice(0, 7);
    const previous = buildMonthlyAssetPoint(dataset, previousMonth, fx, {}, now);
    const flow = point.cashFlowUsd || 0, usdRate = previous.totalUsd > 0 && point.totalUsd != null ? (point.totalUsd - previous.totalUsd - flow) / previous.totalUsd : null;
    const startDate = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10), endDate = end.toISOString().slice(0, 10);
    const before = latest(startDate), after = latest(endDate), benchmarkRate = before > 0 && after > 0 ? after / before - 1 : null;
    return { month, portfolio: usdRate, profit: convertCurrency(point.totalUsd == null || previous.totalUsd == null ? null : point.totalUsd - previous.totalUsd - flow, 'USD', currency, fx), benchmark: benchmarkRate, benchmarkDate: benchmark.findLast?.(bar => bar.date <= endDate)?.date || null, partial: month === current };
  });
}

export function buildDashboardSummary(dataset, cache, now = new Date()) {
  const snapshot = restoreMarketSnapshot(dataset);
  const fx = Number(snapshot.quotes[USDTWD_SYMBOL]?.price) > 0 ? Number(snapshot.quotes[USDTWD_SYMBOL].price) : null;
  const equity = buildCurrentEquity(dataset, snapshot.quotes, fx, now);
  const report = summarize({ fills: dataset.fills || [], marketBars: [] });
  const effective = mergePerformanceCaches(performanceCacheFromSnapshot(dataset), cache);
  const fxBars = effective.entries[`${USDTWD_SYMBOL}:raw`]?.bars || [];
  const currencies = {};
  for (const currency of ['USD', 'TWD']) {
    const total = currencyTotal(equity.assetByCurrency, currency, fx);
    const realized = realizedValue(report.cycles, currency, fxBars) ?? currencyTotal(report.realizedPnlByCurrency, currency, fx);
    const unrealized = currencyTotal(Object.fromEntries(Object.entries(report.positions.reduce((result, position) => {
      const quote = snapshot.quotes[toProviderSymbol(position.symbol, position.market)];
      if (!(Number(quote?.price) > 0)) return result;
      result[position.currency] = (result[position.currency] || 0) + (Number(quote.price) - position.averageCost) * position.quantity * (position.direction === 'SHORT' ? -1 : 1);
      return result;
    }, {}))), currency, fx);
    currencies[currency] = {
      total,
      realized,
      profit: realized == null || unrealized == null ? null : realized + unrealized,
      month: overviewPeriodValuation(dataset, effective, now, currency, total, equity, fx, 'month'),
      ytd: overviewPeriodValuation(dataset, effective, now, currency, total, equity, fx, 'year'),
      week: overviewPeriodValuation(dataset, effective, now, currency, total, equity, fx, 'week'),
      months: (() => {
        const history = historicalMonths(dataset, effective, now, currency, { total, cycles: report.cycles });
        const historyByMonth = new Map(history.map(row => [row.month, row]));
        const fallback = snapshotMonthComparisons(dataset, now, currency, fx);
        const selected = fallback.length ? fallback : history.slice(-3).map(row => ({ month: row.month, partial: row.isCurrent }));
        return selected.slice(-3).map(saved => {
          const row = historyByMonth.get(saved.month);
          return {
            month: saved.month,
            portfolio: row?.return ?? saved.portfolio ?? null,
            profit: row?.change ?? saved.profit ?? null,
            benchmark: row?.benchmark ?? saved.benchmark ?? null,
            benchmarkDate: saved.benchmarkDate ?? null,
            partial: saved.partial ?? row?.isCurrent ?? false,
          };
        });
      })(),
    };
  }
  return { version: 1, asOf: now.toISOString(), currencies };
}
