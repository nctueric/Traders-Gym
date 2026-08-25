import { pnlToUsd, toProviderSymbol } from "./quote-engine.mjs";

const DAY = 86_400_000;

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function startOfWeek(date) {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
}

function endOfWeek(weekStart) {
  return new Date(Date.parse(`${weekStart}T00:00:00Z`) + 6 * DAY).toISOString().slice(0, 10);
}

function cashDirection(type) {
  const normalized = String(type || "").toUpperCase();
  if (["WITHDRAWAL", "FEE", "TAX"].includes(normalized)) return -1;
  return 1;
}

export function buildWeeklyEquitySeries(data, usdTwdRate) {
  const fills = [...(data?.fills || [])].sort((a, b) => dateOnly(a.timestamp).localeCompare(dateOnly(b.timestamp)));
  const activities = [...(data?.cashActivities || [])].filter((activity) => activity.currency && !activity.requiresReview);
  const bars = [...(data?.marketBars || [])].filter((bar) => bar.symbol && bar.date && Number(bar.close) > 0);
  const dates = [...fills.map((fill) => dateOnly(fill.timestamp)), ...activities.map((activity) => dateOnly(activity.timestamp)), ...bars.map((bar) => dateOnly(bar.date))].filter(Boolean);
  if (!dates.length) return [];

  const weeks = [...new Set(dates.map(startOfWeek))].sort();
  const barsBySymbol = new Map();
  for (const bar of bars) {
    if (!barsBySymbol.has(bar.symbol)) barsBySymbol.set(bar.symbol, []);
    barsBySymbol.get(bar.symbol).push(bar);
  }
  for (const symbolBars of barsBySymbol.values()) symbolBars.sort((a, b) => a.date.localeCompare(b.date));

  let previousTotal = null;
  return weeks.map((weekStart) => {
    const weekEnd = endOfWeek(weekStart);
    const inWeekDates = dates.filter((date) => date >= weekStart && date <= weekEnd);
    const asOf = inWeekDates.sort().at(-1) || weekEnd;
    const cashByCurrency = {};
    const holdings = new Map();
    const fallbackPrices = new Map();

    for (const activity of activities.filter((item) => dateOnly(item.timestamp) <= asOf)) {
      cashByCurrency[activity.currency] = (cashByCurrency[activity.currency] || 0) + cashDirection(activity.type) * Number(activity.amount || 0);
    }
    for (const fill of fills.filter((item) => dateOnly(item.timestamp) <= asOf)) {
      const currency = fill.currency || "USD";
      const quantity = Number(fill.quantity);
      const price = Number(fill.price);
      const fee = Number(fill.fee || 0);
      const key = `${fill.accountId || "default"}:${fill.symbol}:${currency}`;
      const quantityDirection = fill.side === "BUY" ? 1 : -1;
      const cashFlow = fill.side === "BUY" ? -(quantity * price + fee) : quantity * price - fee;
      cashByCurrency[currency] = (cashByCurrency[currency] || 0) + cashFlow;
      holdings.set(key, { symbol: fill.symbol, currency, quantity: (holdings.get(key)?.quantity || 0) + quantityDirection * quantity });
      fallbackPrices.set(`${fill.symbol}:${currency}`, price);
    }

    const assetByCurrency = { ...cashByCurrency };
    const missingSymbols = [];
    for (const holding of holdings.values()) {
      if (Math.abs(holding.quantity) <= 1e-9) continue;
      const symbolBars = barsBySymbol.get(holding.symbol) || [];
      const bar = [...symbolBars].reverse().find((item) => item.date <= asOf);
      const price = bar ? Number(bar.close) : fallbackPrices.get(`${holding.symbol}:${holding.currency}`);
      if (!bar) missingSymbols.push(holding.symbol);
      if (Number.isFinite(price)) assetByCurrency[holding.currency] = (assetByCurrency[holding.currency] || 0) + holding.quantity * price;
    }

    const totalUsd = pnlToUsd(assetByCurrency, usdTwdRate);
    const changeUsd = totalUsd == null || previousTotal == null ? null : totalUsd - previousTotal;
    const changePct = changeUsd == null || previousTotal === 0 ? null : changeUsd / Math.abs(previousTotal);
    if (totalUsd != null) previousTotal = totalUsd;
    return { weekStart, weekEnd, asOf, totalUsd, changeUsd, changePct, assetByCurrency, missingSymbols: [...new Set(missingSymbols)] };
  });
}

export function buildCurrentEquity(data, quotes = {}, usdTwdRate, now = new Date()) {
  const fills = [...(data?.fills || [])];
  const activities = [...(data?.cashActivities || [])].filter((activity) => activity.currency && !activity.requiresReview);
  const cashByCurrency = {};
  const holdings = new Map();
  const fallbackPrices = new Map();

  for (const activity of activities) {
    cashByCurrency[activity.currency] = (cashByCurrency[activity.currency] || 0) + cashDirection(activity.type) * Number(activity.amount || 0);
  }
  for (const fill of fills) {
    const currency = fill.currency || "USD";
    const quantity = Number(fill.quantity);
    const price = Number(fill.price);
    const fee = Number(fill.fee || 0);
    const key = `${fill.accountId || "default"}:${fill.symbol}:${currency}`;
    const quantityDirection = fill.side === "BUY" ? 1 : -1;
    const cashFlow = fill.side === "BUY" ? -(quantity * price + fee) : quantity * price - fee;
    cashByCurrency[currency] = (cashByCurrency[currency] || 0) + cashFlow;
    holdings.set(key, { symbol: fill.symbol, market: fill.market || "", currency, quantity: (holdings.get(key)?.quantity || 0) + quantityDirection * quantity });
    fallbackPrices.set(`${fill.symbol}:${currency}`, price);
  }

  const latestBars = new Map();
  for (const bar of data?.marketBars || []) {
    if (!bar?.symbol || !bar?.date || !(Number(bar.close) > 0)) continue;
    const current = latestBars.get(bar.symbol);
    if (!current || String(bar.date) > String(current.date)) latestBars.set(bar.symbol, bar);
  }

  const assetByCurrency = { ...cashByCurrency };
  const missingSymbols = [];
  let liveQuoteCount = 0;
  let positionCount = 0;
  for (const holding of holdings.values()) {
    if (Math.abs(holding.quantity) <= 1e-9) continue;
    positionCount += 1;
    const providerSymbol = toProviderSymbol(holding.symbol, holding.market);
    const quote = quotes[providerSymbol];
    const fallback = latestBars.get(holding.symbol)?.close ?? fallbackPrices.get(`${holding.symbol}:${holding.currency}`);
    const price = quote && Number(quote.price) > 0 ? Number(quote.price) : Number(fallback);
    if (quote && Number(quote.price) > 0) liveQuoteCount += 1;
    else missingSymbols.push(holding.symbol);
    if (Number.isFinite(price)) assetByCurrency[holding.currency] = (assetByCurrency[holding.currency] || 0) + holding.quantity * price;
  }

  return {
    asOf: now.toISOString(),
    totalUsd: pnlToUsd(assetByCurrency, usdTwdRate),
    assetByCurrency,
    missingSymbols: [...new Set(missingSymbols)],
    liveQuoteCount,
    positionCount,
  };
}

export function buildWeeklyPerformance(equityPoints = [], benchmarkBars = []) {
  const weeklyBenchmark = new Map();
  for (const bar of [...benchmarkBars].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    if (!bar?.date || !Number.isFinite(Number(bar.close))) continue;
    weeklyBenchmark.set(startOfWeek(dateOnly(bar.date)), Number(bar.close));
  }
  const benchmarkReturns = new Map();
  let previousClose = null;
  for (const [weekStart, close] of [...weeklyBenchmark.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    benchmarkReturns.set(weekStart, previousClose == null || previousClose === 0 ? null : close / previousClose - 1);
    previousClose = close;
  }
  return equityPoints.map((point) => ({
    weekStart: point.weekStart,
    asOf: point.asOf,
    totalUsd: point.totalUsd,
    portfolioPct: point.changePct,
    benchmarkPct: benchmarkReturns.get(point.weekStart) ?? null,
  }));
}

export function monthlyAssetChange(equityPoints = [], monthKey) {
  const valid = equityPoints.filter((point) => point.totalUsd != null).sort((a, b) => a.asOf.localeCompare(b.asOf));
  if (!valid.length || !monthKey) return null;
  const inMonth = valid.filter((point) => point.asOf.startsWith(monthKey));
  if (!inMonth.length) return null;
  const baseline = [...valid].reverse().find((point) => point.asOf < `${monthKey}-01`) || inMonth[0];
  return Number(inMonth.at(-1).totalUsd) - Number(baseline.totalUsd);
}

export function monthlyCycleScore(cycles = [], monthKey) {
  const monthCycles = cycles.filter((cycle) => dateOnly(cycle.closeAt).startsWith(monthKey));
  const returns = monthCycles.map((cycle) => Number(cycle.returnPct)).filter(Number.isFinite);
  const winningCycles = monthCycles.filter((cycle) => Number(cycle.pnl) > 0);
  const losingCycles = monthCycles.filter((cycle) => Number(cycle.pnl) < 0);
  const winningReturns = winningCycles.map((cycle) => Number(cycle.returnPct)).filter(Number.isFinite);
  const losingReturns = losingCycles.map((cycle) => Number(cycle.returnPct)).filter(Number.isFinite);
  const averageAmountByCurrency = (items) => {
    const totals = {};
    const counts = {};
    for (const cycle of items) {
      const amount = Number(cycle.pnl);
      if (!Number.isFinite(amount)) continue;
      const currency = cycle.currency || "USD";
      totals[currency] = (totals[currency] || 0) + amount;
      counts[currency] = (counts[currency] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(totals).map(([currency, total]) => [currency, total / counts[currency]]));
  };
  const winners = winningCycles.length;
  const losers = losingCycles.length;
  const flat = monthCycles.length - winners - losers;
  return {
    cycles: monthCycles,
    averageReturn: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
    averageWinningReturn: winningReturns.length ? winningReturns.reduce((sum, value) => sum + value, 0) / winningReturns.length : null,
    averageLosingReturn: losingReturns.length ? losingReturns.reduce((sum, value) => sum + value, 0) / losingReturns.length : null,
    averageWinningAmountByCurrency: averageAmountByCurrency(winningCycles),
    averageLosingAmountByCurrency: averageAmountByCurrency(losingCycles),
    winners,
    losers,
    flat,
    winRate: winners + losers ? winners / (winners + losers) : null,
  };
}
