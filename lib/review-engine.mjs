import { pnlToUsd } from "./quote-engine.mjs";

const DAY = 86_400_000;
const HOUR = 3_600_000;

export function taipeiDate(value) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function taipeiWeekStart(value) {
  const date = new Date(`${taipeiDate(value)}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function tradingDaysBetween(startValue, endValue) {
  let current = new Date(`${taipeiDate(startValue)}T00:00:00Z`);
  const end = new Date(`${taipeiDate(endValue)}T00:00:00Z`);
  let count = 0;
  while (current < end) {
    current = new Date(current.getTime() + DAY);
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export function findRapidRepurchases(cycles = [], windowTradingDays = 3) {
  const sorted = [...cycles].sort((a, b) => String(a.openAt).localeCompare(String(b.openAt)));
  const pairs = [];
  for (const previous of sorted) {
    for (const next of sorted) {
      if (next.id === previous.id || next.accountId !== previous.accountId || next.symbol !== previous.symbol || String(next.openAt) <= String(previous.closeAt)) continue;
      const gapTradingDays = tradingDaysBetween(previous.closeAt, next.openAt);
      if (gapTradingDays <= windowTradingDays) pairs.push({ previousCycleId: previous.id, nextCycleId: next.id, symbol: previous.symbol, gapTradingDays, nextOpenAt: next.openAt });
      break;
    }
  }
  return pairs;
}

export function analyzeCycle(cycle, marketBars = [], review = {}) {
  const startDate = taipeiDate(cycle.openAt);
  const closeDate = taipeiDate(cycle.closeAt);
  const symbolBars = marketBars.filter((bar) => bar.symbol === cycle.symbol && bar.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const holdingBars = symbolBars.filter((bar) => bar.date >= startDate && bar.date <= closeDate);
  const postBars = symbolBars.filter((bar) => bar.date > closeDate && Number(bar.close) > 0);
  const postExitReturns = {};
  for (const horizon of [1, 3, 5, 10, 20]) {
    const bar = postBars[horizon - 1];
    postExitReturns[horizon] = bar ? (cycle.direction === "SHORT" ? Number(cycle.averageExit) - Number(bar.close) : Number(bar.close) - Number(cycle.averageExit)) / Number(cycle.averageExit) : null;
  }
  const mfe = Number.isFinite(Number(cycle.mfePct)) ? Number(cycle.mfePct) : null;
  const realizedReturn = Number.isFinite(Number(cycle.returnPct)) ? Number(cycle.returnPct) : null;
  const mfeRetention = mfe != null && mfe > 0 && realizedReturn != null ? realizedReturn / mfe : null;
  const maxGiveback = mfe != null && realizedReturn != null ? mfe - realizedReturn : null;
  const plannedStop = Number(review.plannedStop);
  const revisedStop = Number(review.revisedStop);
  const entry = Number(cycle.averageEntry);
  const exit = Number(cycle.averageExit);
  const quantity = Number(cycle.quantity);
  const riskPerUnit = plannedStop > 0 ? (cycle.direction === "SHORT" ? plannedStop - entry : entry - plannedStop) : null;
  const initialRisk = riskPerUnit != null && riskPerUnit > 0 ? riskPerUnit * quantity : null;
  const rMultiple = initialRisk ? Number(cycle.pnl) / initialRisk : null;
  const stopDelayCost = initialRisk ? Math.max(0, (cycle.direction === "SHORT" ? exit - plannedStop : plannedStop - exit) * quantity) : null;
  const revisedRiskPerUnit = revisedStop > 0 ? (cycle.direction === "SHORT" ? revisedStop - entry : entry - revisedStop) : null;
  const ruleModificationCost = initialRisk && revisedRiskPerUnit != null && revisedRiskPerUnit > 0 ? Math.max(0, revisedRiskPerUnit * quantity - initialRisk) : null;
  return {
    holdingHours: Math.max(0, (new Date(cycle.closeAt).getTime() - new Date(cycle.openAt).getTime()) / HOUR),
    tradingDays: holdingBars.length || null,
    sameDay: startDate === closeDate,
    precision: holdingBars.length ? "日線近似" : "缺行情",
    mfeRetention,
    maxGiveback,
    postExitReturns,
    initialRisk,
    rMultiple,
    stopDelayCost,
    ruleModificationCost,
  };
}

export function weeklyCycleStats(cycles = [], usdTwdRate) {
  const groups = new Map();
  for (const cycle of cycles) {
    const weekStart = taipeiWeekStart(cycle.closeAt);
    if (!groups.has(weekStart)) groups.set(weekStart, []);
    groups.get(weekStart).push(cycle);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([weekStart, items]) => {
    const returns = items.map((cycle) => Number(cycle.returnPct)).filter(Number.isFinite);
    const pnlByCurrency = items.reduce((totals, cycle) => {
      const currency = cycle.currency || "USD";
      totals[currency] = (totals[currency] || 0) + Number(cycle.pnl || 0);
      return totals;
    }, {});
    const winners = items.filter((cycle) => Number(cycle.pnl) > 0).length;
    const losers = items.filter((cycle) => Number(cycle.pnl) < 0).length;
    return {
      weekStart,
      weekEnd: new Date(Date.parse(`${weekStart}T00:00:00Z`) + 6 * DAY).toISOString().slice(0, 10),
      sampleCount: items.length,
      averageReturn: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
      winners,
      losers,
      winRate: winners + losers ? winners / (winners + losers) : null,
      totalPnlByCurrency: pnlByCurrency,
      totalPnlUsd: pnlToUsd(pnlByCurrency, usdTwdRate),
    };
  });
}
