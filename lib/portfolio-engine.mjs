import { pnlToUsd } from "./quote-engine.mjs";

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
