import { buildCurrentEquity } from "./portfolio-engine.mjs";
import { buildCycles } from "./trade-engine.mjs";
import { pnlToUsd, toProviderSymbol } from "./quote-engine.mjs";

const day = value => String(value || "").slice(0, 10);
const validDate = value => /^\d{4}-\d{2}-\d{2}/.test(String(value)) && Number.isFinite(Date.parse(value));
const amountUsd = (items, rate) => {
  if (items.some(item => item.requiresReview || !["USD", "TWD"].includes(item.currency) || !Number.isFinite(Number(item.amount)))) return null;
  const totals = {};
  for (const item of items) totals[item.currency] = (totals[item.currency] || 0) + Number(item.amount);
  return pnlToUsd(totals, rate);
};

export const ASSET_SEGMENTS = [
  { key: "baseUsd", label: "本金／其他帳務淨額", color: "#bccac3", negative: "#889990" },
  { key: "depositUsd", label: "本月入金", color: "#e6bb34", negative: "#e6bb34" },
  { key: "withdrawalUsd", label: "本月出金／現金校正", color: "#d4483b", negative: "#d4483b" },
  { key: "realizedUsd", label: "累計已實現（深色）", color: "#176b50", negative: "#a13d34" },
  { key: "unrealizedUsd", label: "未實現（淺色）", color: "#8fbaa4", negative: "#dfa99f" },
];

/** Signed waterfall within each month; never add total P&L on top of realized. */
export function monthlyAssetSegments(point) {
  if (point.totalUsd == null || ASSET_SEGMENTS.some(segment => point[segment.key] == null)) return [];
  let running = 0;
  return ASSET_SEGMENTS.map(segment => {
    const value = segment.key === "withdrawalUsd" ? -point.withdrawalUsd : point[segment.key];
    const from = running;
    running += value;
    return { ...segment, value, from, to: running, color: value < 0 ? segment.negative : segment.color };
  });
}

function monthKeys(data, now) {
  const today = now.toISOString().slice(0, 10);
  const dates = [...(data.fills || []), ...(data.cashActivities || [])].map(item => item.timestamp).filter(validDate).map(day).filter(date => date <= today).sort();
  if (!dates.length) return [];
  const result = [];
  const cursor = new Date(dates[0].slice(0, 7) + "-01T00:00:00Z");
  while (cursor.toISOString().slice(0, 7) <= today.slice(0, 7)) {
    result.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

export function buildMonthlyAssetPoint(data, month, rate, quotes = {}, now = new Date()) {
  const isCurrent = month === now.toISOString().slice(0, 7);
  const monthEnd = new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 0, 23, 59, 59, 999));
  const end = isCurrent ? now : monthEnd;
  const asOf = end.toISOString().slice(0, 10);
  const fills = (data.fills || []).filter(fill => validDate(fill.timestamp) && new Date(fill.timestamp) <= end);
  const activities = (data.cashActivities || []).filter(item => validDate(item.timestamp) && new Date(item.timestamp) <= end);
  const bars = (data.marketBars || []).filter(bar => bar.date && bar.date <= asOf);
  const snapshot = { ...data, fills, cashActivities: activities, marketBars: bars };
  const problems = [];
  const hasBaseline = activities.some(item => !item.requiresReview && item.currency && ["DEPOSIT", "OPENING_BALANCE"].includes(String(item.type).toUpperCase()));
  if (!hasBaseline) problems.push("缺期初資金資料");
  if (activities.some(item => item.requiresReview || !item.currency)) problems.push("有未確認幣別的資金活動");
  if ([...fills, ...activities].some(item => item.currency && !["USD", "TWD"].includes(item.currency))) problems.push("有不支援的幣別");
  const equity = buildCurrentEquity(snapshot, isCurrent ? quotes : {}, rate, end);
  if (equity.totalUsd == null) problems.push("缺匯率");
  if (equity.unpricedPositionCount) problems.push("缺持倉估值");
  const report = buildCycles({ fills, marketBars: [] });
  const latestBars = new Map();
  for (const bar of bars) if (Number(bar.close) > 0 && (!latestBars.has(bar.symbol) || latestBars.get(bar.symbol).date < bar.date)) latestBars.set(bar.symbol,bar);
  const latestFills = new Map();
  for (const fill of fills) {
    const key=`${fill.symbol}:${fill.currency || "USD"}`;
    if(!latestFills.has(key) || new Date(fill.timestamp)>new Date(latestFills.get(key).timestamp)) latestFills.set(key,fill);
  }
  const unrealizedByCurrency = {};
  const estimatedSymbols = [], staleSymbols = [];
  for (const position of report.positions) {
    const quote = isCurrent ? quotes[toProviderSymbol(position.symbol, position.market)] : null;
    const latestFill = latestFills.get(`${position.symbol}:${position.currency}`);
    const bar = latestBars.get(position.symbol);
    const hasQuote = Number(quote?.price)>0;
    const price = hasQuote ? Number(quote.price) : Number(bar?.close ?? latestFill?.price);
    if (!hasQuote && !bar) estimatedSymbols.push(position.symbol);
    if (!hasQuote && bar && Date.parse(asOf) - Date.parse(bar.date) > 7*86400000) staleSymbols.push(position.symbol);
    const value = (price-position.averageCost)*position.quantity*(position.direction === "SHORT" ? -1 : 1);
    unrealizedByCurrency[position.currency] = (unrealizedByCurrency[position.currency] || 0) + value;
  }
  const realizedByCurrency = {};
  for (const cycle of report.cycles) realizedByCurrency[cycle.currency] = (realizedByCurrency[cycle.currency] || 0) + cycle.pnl;
  const realizedUsd = pnlToUsd(realizedByCurrency,rate), unrealizedUsd = pnlToUsd(unrealizedByCurrency,rate);
  const monthActivities = activities.filter(item => day(item.timestamp).startsWith(month));
  const deposits = monthActivities.filter(item => String(item.type).toUpperCase() === "DEPOSIT");
  const withdrawals = monthActivities.filter(item => String(item.type).toUpperCase() === "WITHDRAWAL");
  const depositUsd = amountUsd(deposits,rate), withdrawalUsd = amountUsd(withdrawals,rate);
  const pnlUsd = realizedUsd == null || unrealizedUsd == null ? null : realizedUsd + unrealizedUsd;
  if ([realizedUsd,unrealizedUsd,depositUsd,withdrawalUsd].some(value=>value==null) && !problems.includes("缺匯率")) problems.push("資金幣別或匯率待補");
  const totalUsd = problems.length ? null : equity.totalUsd;
  // Residual is explicitly labelled: it includes prior funding, cash baseline
  // corrections, fees and P&L from partially exited cycles not yet closed.
  const baseUsd = totalUsd == null || pnlUsd == null || depositUsd == null || withdrawalUsd == null ? null
    : totalUsd - pnlUsd - depositUsd + withdrawalUsd;
  return {
    month, asOf, isCurrent, totalUsd, realizedUsd, unrealizedUsd, pnlUsd, depositUsd, withdrawalUsd, baseUsd,
    cashFlowUsd: depositUsd == null || withdrawalUsd == null ? null : depositUsd-withdrawalUsd,
    problems, estimatedSymbols:[...new Set(estimatedSymbols)], staleSymbols:[...new Set(staleSymbols)],
    flows: [...deposits,...withdrawals].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp)).map(item => ({id:item.id,date:day(item.timestamp),type:item.type,currency:item.currency,amount:Number(item.amount),note:item.note || "",requiresReview:!!item.requiresReview})),
    closedCycleCount: report.cycles.length,
  };
}

/** Historical results do not depend on live quotes or countdown renders. */
export function buildMonthlyAssetHistory(data, rate, now = new Date()) {
  const keys=monthKeys(data,now);
  return keys.filter(month=>month!==now.toISOString().slice(0,7)).map(month=>buildMonthlyAssetPoint(data,month,rate,{},now));
}

export function withMonthlyChanges(points) {
  return points.map((point,index)=>({ ...point,
    changeUsd:index && point.totalUsd != null && points[index-1].totalUsd != null ? point.totalUsd-points[index-1].totalUsd : null,
  }));
}
