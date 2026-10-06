import { buildBehaviorMatrices } from "./behavior-matrix.mjs";
import { withEma, emaWarmupStart } from "./chart-indicators.mjs";
import { pnlToUsd } from "./quote-engine.mjs";
import { analyzeCycle, taipeiDate, taipeiWeekStart } from "./review-engine.mjs";
import { strategyReplayEvents } from "./strategy-engine.mjs";
import { entryReplayEvents } from "./trade-entry.mjs";
import { buildQualityTagAnalysis, exitQualityGroup, normalizeEntryQualityTag, normalizeExitQualityTag } from "./quality-rating.mjs";

const DAY = 86_400_000;
const FINDING_COPY = {
  MFE_GIVEBACK: { title: "獲利回吐", description: "曾有明顯浮盈，但實際出場保留不足。", trigger: "MFE留存率低於50%", action: "持倉進入獲利區後，依原計畫分批落袋或上移保護線。", metric: "MFE回吐金額" },
  STOP_DELAY: { title: "停損延遲", description: "實際出場比事前停損承受更多損失。", trigger: "價格失效後仍延後出場", action: "觸及事前停損後不擴大風險，例外必須先留下理由。", metric: "停損延遲成本" },
  RAPID_REPURCHASE: { title: "快速買回", description: "出場後三個交易日內重新建立同標的部位。", trigger: "平倉後3個交易日內買回", action: "重新進場前完成新假設、失效條件與冷卻檢查。", metric: "快速買回次數" },
  LOSS_ADDING: { title: "虧損加碼", description: "部位處於不利價格時仍擴大曝險。", trigger: "加碼價格劣於當時平均成本", action: "虧損部位加碼前，重新確認風險上限與失效條件。", metric: "虧損加碼次數" },
  CHASE_ENTRY: { title: "追價進場", description: "首筆成交相對當日開盤已有明顯延伸。", trigger: "進場價偏離當日開盤超過3%", action: "延伸超過3%時等待回測或縮小初始部位。", metric: "追價進場次數" },
  POST_HOC_PLAN: { title: "先交易後補理由", description: "計畫內容在交易結束後才建立或修改。", trigger: "計畫建立時間晚於平倉時間", action: "進場前先寫下假設、失效條件與初始停損。", metric: "事後補計畫比例" },
};

function validNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function priceForBar(bar, field, fallback) {
  const value = validNumber(bar?.[field]);
  return value != null && value > 0 ? value : fallback;
}

function shiftCalendarMonths(date, months) {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
  value.setUTCDate(Math.min(day, lastDay));
  return value.toISOString().slice(0, 10);
}

export function replayWindowDates(cycle) {
  const open = taipeiDate(cycle.openAt);
  const close = taipeiDate(cycle.closeAt);
  return { open, close, start: shiftCalendarMonths(open, -3), end: shiftCalendarMonths(close, 3) };
}

export function openPositionWindowDates(position, asOf = new Date()) {
  const open = taipeiDate(position.openAt);
  const end = typeof asOf === "string" ? taipeiDate(asOf) : asOf.toISOString().slice(0, 10);
  return { open, close: end, start: shiftCalendarMonths(open, -3), end };
}

function normalizedCandles(cycle, marketBars) {
  const { open: openDate, close: closeDate, start, end } = replayWindowDates(cycle);
  const history = [...new Map((marketBars || []).filter((bar) => bar.symbol === cycle.symbol && bar.date >= emaWarmupStart(start) && bar.date <= end).map((bar) => [bar.date, bar])).values()]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((bar) => {
      const closePrice = validNumber(bar.close);
      if (!(closePrice > 0)) return null;
      const open = priceForBar(bar, "open", closePrice);
      const high = priceForBar(bar, "high", Math.max(open, closePrice));
      const low = priceForBar(bar, "low", Math.min(open, closePrice));
      const date = String(bar.date);
      return { date, rawOhlc: Object.fromEntries(["open","high","low","close"].map(field => [field, bar[field] == null || !(validNumber(bar[field]) > 0) ? null : validNumber(bar[field])])), open, high: Math.max(high, open, closePrice), low: Math.min(low, open, closePrice), close: closePrice, volume: bar.volume == null ? null : validNumber(bar.volume), phase: date < openDate ? "PRE_ENTRY" : date <= closeDate ? "HOLDING" : "POST_EXIT" };
    })
    .filter(Boolean);
  const normalized = withEma(history).filter((bar) => bar.date >= start).slice(0, 250);
  return normalized.map((candle, index) => {
    const volumeWindow = normalized.slice(Math.max(0, index - 19), index + 1).map((row) => row.volume).filter((volume) => volume != null && volume >= 0);
    const averageVolume20 = volumeWindow.length === 20 ? volumeWindow.reduce((sum, volume) => sum + volume, 0) / 20 : null;
    return { ...candle, averageVolume20, volumeRatio: candle.volume != null && averageVolume20 > 0 ? candle.volume / averageVolume20 : null };
  });
}

function buildFillEvents(cycle) {
  let positionQuantity = 0;
  const entrySide = cycle.direction === "SHORT" ? "SELL" : "BUY";
  return [...(cycle.fills || [])].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).map((fill, index, fills) => {
    const isAdd = fill.side === entrySide;
    const beforeQuantity = positionQuantity;
    positionQuantity = Math.max(0, positionQuantity + (isAdd ? Number(fill.quantity) : -Number(fill.quantity)));
    const type = isAdd ? (beforeQuantity === 0 ? "ENTRY" : "ADD") : positionQuantity === 0 ? "EXIT" : "REDUCE";
    const label = type === "ENTRY" ? "建倉" : type === "ADD" ? "加碼" : type === "EXIT" ? "出場" : "減碼";
    return {
      id: `fill:${fill.id || index}`,
      type,
      date: taipeiDate(fill.timestamp),
      timestamp: fill.timestamp,
      price: Number(fill.price),
      quantity: Number(fill.quantity),
      beforeQuantity,
      afterQuantity: positionQuantity,
      label,
      detail: `${fill.side === "BUY" ? "買進" : "賣出"} ${fill.quantity} 股`,
      note: fill.note || "",
      source: "FILL",
      sortOrder: index,
      isLastFill: index === fills.length - 1,
    };
  });
}

function cyclePlanVersions(cycle, planHistory = [], review = {}) {
  const explicit = (planHistory || []).filter((version) => {
    if (version.cycleId) return version.cycleId === cycle.id;
    return version.accountId === cycle.accountId && version.symbol === cycle.symbol && version.effectiveAt && String(version.effectiveAt) >= String(cycle.openAt) && String(version.effectiveAt) <= String(cycle.closeAt);
  }).map((version, index) => ({
    id: version.id || `plan:${cycle.id}:${index}`,
    type: version.field === "stopLoss" ? "PLAN_STOP" : version.field === "takeProfit" ? "PLAN_TARGET" : "PLAN_INVALIDATION",
    date: version.effectiveAt ? taipeiDate(version.effectiveAt) : null,
    timestamp: version.effectiveAt || null,
    price: version.field === "stopLoss" || version.field === "takeProfit" ? validNumber(version.value) : null,
    label: version.field === "stopLoss" ? "停損版本" : version.field === "takeProfit" ? "停利版本" : "失效條件",
    detail: version.reason || String(version.value ?? ""),
    note: version.reason || "",
    createdAt: version.createdAt || null,
    source: version.source || "USER",
    legacy: !version.effectiveAt,
    sortOrder: 100 + index,
  }));
  const hasStop = explicit.some((event) => event.type === "PLAN_STOP");
  const hasTarget = explicit.some((event) => event.type === "PLAN_TARGET");
  const legacy = [];
  if (!hasStop && validNumber(review.plannedStop) > 0) legacy.push({ id: `legacy-stop:${cycle.id}`, type: "PLAN_STOP", date: null, timestamp: null, price: Number(review.plannedStop), label: "事前停損", detail: "歷史值，生效時間不明", note: "", source: "LEGACY", legacy: true, sortOrder: 190 });
  if (!hasStop && validNumber(review.revisedStop) > 0) legacy.push({ id: `legacy-revised-stop:${cycle.id}`, type: "PLAN_STOP", date: null, timestamp: null, price: Number(review.revisedStop), label: "修訂停損", detail: "歷史值，生效時間不明", note: "", source: "LEGACY", legacy: true, sortOrder: 191 });
  if (!hasTarget && validNumber(review.takeProfit) > 0) legacy.push({ id: `legacy-target:${cycle.id}`, type: "PLAN_TARGET", date: null, timestamp: null, price: Number(review.takeProfit), label: "停利目標", detail: "歷史值，生效時間不明", note: "", source: "LEGACY", legacy: true, sortOrder: 192 });
  if (review.invalidation && !explicit.some((event) => event.type === "PLAN_INVALIDATION")) legacy.push({ id: `legacy-invalidation:${cycle.id}`, type: "PLAN_INVALIDATION", date: null, timestamp: null, price: null, label: "失效條件", detail: "歷史文字，生效時間不明", note: review.invalidation, source: "LEGACY", legacy: true, sortOrder: 193 });
  return [...explicit, ...legacy];
}

function excursionEvents(cycle, candles) {
  const holding = candles.filter((candle) => candle.phase === "HOLDING");
  if (!holding.length) return [];
  const adverse = cycle.direction === "SHORT"
    ? holding.reduce((best, candle) => candle.high > best.high ? candle : best)
    : holding.reduce((best, candle) => candle.low < best.low ? candle : best);
  const favorable = cycle.direction === "SHORT"
    ? holding.reduce((best, candle) => candle.low < best.low ? candle : best)
    : holding.reduce((best, candle) => candle.high > best.high ? candle : best);
  return [
    { id: `mae:${cycle.id}`, type: "MAE", date: adverse.date, timestamp: `${adverse.date}T00:00:00Z`, price: cycle.direction === "SHORT" ? adverse.high : adverse.low, label: "最大不利波動 MAE", detail: cycle.maePct == null ? "—" : `${(Number(cycle.maePct) * 100).toFixed(1)}%`, source: "METRIC", sortOrder: 300 },
    { id: `mfe:${cycle.id}`, type: "MFE", date: favorable.date, timestamp: `${favorable.date}T00:00:00Z`, price: cycle.direction === "SHORT" ? favorable.low : favorable.high, label: "最大有利波動 MFE", detail: cycle.mfePct == null ? "—" : `+${(Number(cycle.mfePct) * 100).toFixed(1)}%`, source: "METRIC", sortOrder: 301 },
  ];
}

export function buildCycleReplay(cycle, marketBars = [], planHistory = [], review = {}, rapidPairs = [], decisionLinks = {}, strategies = [], strategyAssignments = {}, entryContexts = {}) {
  const window = replayWindowDates(cycle);
  const candles = normalizedCandles(cycle, marketBars);
  const fillEvents = buildFillEvents(cycle);
  const planEvents = cyclePlanVersions(cycle, planHistory, review);
  const excursions = excursionEvents(cycle, candles);
  const repurchases = rapidPairs.filter((pair) => pair.previousCycleId === cycle.id).map((pair, index) => ({
    id: `repurchase:${pair.previousCycleId}:${pair.nextCycleId}`,
    type: "RAPID_REPURCHASE",
    date: pair.nextOpenAt ? taipeiDate(pair.nextOpenAt) : null,
    timestamp: pair.nextOpenAt || null,
    price: null,
    label: "快速買回",
    detail: `${pair.gapTradingDays} 個交易日後重新建倉${decisionLinks[`${pair.previousCycleId}>${pair.nextCycleId}`]?.linked ? "・已連結決策鏈" : "・待確認"}`,
    source: "DETECTOR",
    sortOrder: 400 + index,
  }));
  const strategyEvents = strategyReplayEvents(cycle, strategies, strategyAssignments);
  const datedEvents = [...fillEvents, ...planEvents, ...excursions, ...repurchases, ...strategyEvents, ...entryReplayEvents(cycle, entryContexts)].sort((a, b) => {
    if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp)) || a.sortOrder - b.sortOrder;
    if (a.timestamp) return -1;
    if (b.timestamp) return 1;
    return a.sortOrder - b.sortOrder;
  });
  return {
    cycleId: cycle.id,
    symbol: cycle.symbol,
    direction: cycle.direction,
    candles,
    events: datedEvents,
    averageEntry: Number(cycle.averageEntry),
    openDate: taipeiDate(cycle.openAt),
    closeDate: taipeiDate(cycle.closeAt),
    windowStart: window.start,
    windowEnd: window.end,
    sameDay: taipeiDate(cycle.openAt) === taipeiDate(cycle.closeAt),
    precision: candles.length ? "日線近似" : "缺行情",
    legacyPlanCount: planEvents.filter((event) => event.legacy).length,
    preEntryCount: candles.filter((candle) => candle.phase === "PRE_ENTRY").length,
    holdingCount: candles.filter((candle) => candle.phase === "HOLDING").length,
    postExitCount: candles.filter((candle) => candle.phase === "POST_EXIT").length,
  };
}

export function buildOpenPositionReplay(position, marketBars = [], planHistory = [], plan = {}, asOf = new Date(), strategies = [], strategyAssignments = {}, entryContexts = {}) {
  const closeAt = typeof asOf === "string" ? asOf : asOf.toISOString();
  const cycle = {
    ...position,
    id: position.id || `open-${position.accountId}-${position.symbol}-${taipeiDate(position.openAt)}`,
    status: "OPEN",
    closeAt,
    averageEntry: Number(position.averageCost),
    averageExit: null,
  };
  const hasExplicitStop = (planHistory || []).some((version) => version.cycleId === cycle.id && version.field === "stopLoss");
  const hasExplicitTarget = (planHistory || []).some((version) => version.cycleId === cycle.id && version.field === "takeProfit");
  const hasExplicitInvalidation = (planHistory || []).some((version) => version.cycleId === cycle.id && version.field === "invalidation");
  const effectiveAt = plan.updatedAt || position.openAt;
  const currentVersions = [
    !hasExplicitStop && validNumber(plan.stopLoss) > 0 ? { field: "stopLoss", value: Number(plan.stopLoss), reason: "目前持倉計畫" } : null,
    !hasExplicitTarget && validNumber(plan.takeProfit) > 0 ? { field: "takeProfit", value: Number(plan.takeProfit), reason: "目前持倉計畫" } : null,
    !hasExplicitInvalidation && String(plan.note || "").trim() ? { field: "invalidation", value: String(plan.note).trim(), reason: "目前失效條件" } : null,
  ].filter(Boolean).map((version, index) => ({
    id: `current-plan-${cycle.id}-${version.field}-${index}`,
    cycleId: cycle.id,
    accountId: cycle.accountId,
    symbol: cycle.symbol,
    ...version,
    effectiveAt,
    createdAt: effectiveAt,
    source: "CURRENT_POSITION",
  }));
  const replay = buildCycleReplay(cycle, marketBars, [...(planHistory || []), ...currentVersions], {}, [], {}, strategies, strategyAssignments, entryContexts);
  return { ...replay, status: "OPEN", closeDate: null, windowEnd: openPositionWindowDates(position, asOf).end, postExitCount: 0 };
}

/** @param {number|null} [limit] */
export function filterCyclesByPeriod(cycles = [], startMonth = "", endMonth = "", limit = null) {
  const filtered = [...cycles]
    .filter((cycle) => {
      const month = taipeiDate(cycle.closeAt).slice(0, 7);
      return (!startMonth || month >= startMonth) && (!endMonth || month <= endMonth);
    })
    .sort((a, b) => String(b.closeAt).localeCompare(String(a.closeAt)));
  const numericLimit = Number(limit);
  return numericLimit > 0 ? filtered.slice(0, numericLimit) : filtered;
}

export function cycleAnalysisPeriod(cycle, scope = "all") {
  const date = taipeiDate(cycle.closeAt);
  if (scope === "year") return date.slice(0, 4);
  if (scope === "month") return date.slice(0, 7);
  if (scope === "week") return taipeiWeekStart(cycle.closeAt);
  return "all";
}

function averageOrNull(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** @param {number|null} [usdTwdRate] */
export function buildProfitLossTradeStats(cycles = [], scope = "all", period = "", usdTwdRate = null) {
  const selected = cycles.filter((cycle) => scope === "all" || cycleAnalysisPeriod(cycle, scope) === period);
  const summarizeGroup = (items) => {
    const pnlUsd = items.map((cycle) => pnlToUsd({ [cycle.currency || "USD"]: Number(cycle.pnl) }, usdTwdRate));
    const entryUsd = items.map((cycle) => pnlToUsd({ [cycle.currency || "USD"]: Number(cycle.entryNotional) }, usdTwdRate));
    const missingFx = pnlUsd.some((value) => value == null) || entryUsd.some((value) => value == null);
    const holdingDays = items.map(cycle => {
      if (Number.isFinite(cycle.holdingDays) && cycle.holdingDays >= 0) return cycle.holdingDays;
      const days = (Date.parse(cycle.closeAt) - Date.parse(cycle.openAt)) / 86400000;
      return Number.isFinite(days) && days >= 0 ? Math.round(days) : null;
    });
    const missingHoldingDays = holdingDays.filter(value => value == null).length;
    return {
      count: items.length,
      totalPnlUsd: pnlUsd.some(value => value == null) ? null : pnlUsd.reduce((sum, value) => sum + value, 0),
      missingFxCount: pnlUsd.filter(value => value == null).length,
      averageHoldingDays: missingHoldingDays ? null : averageOrNull(holdingDays),
      missingHoldingDays,
      averageReturn: averageOrNull(items.map((cycle) => Number(cycle.returnPct)).filter(Number.isFinite)),
      averagePnlUsd: missingFx ? null : averageOrNull(pnlUsd),
      averageEntryNotionalUsd: missingFx ? null : averageOrNull(entryUsd),
      missingFx,
    };
  };
  const winners = summarizeGroup(selected.filter((cycle) => Number(cycle.pnl) > 0));
  const losers = summarizeGroup(selected.filter((cycle) => Number(cycle.pnl) < 0));
  const totals = summarizeGroup(selected);
  const decidedCount = winners.count + losers.count;
  const winRate = decidedCount ? winners.count / decidedCount : null;
  const rewardRisk = winners.averageReturn != null && losers.averageReturn != null && losers.averageReturn < 0
    ? winners.averageReturn / Math.abs(losers.averageReturn)
    : null;
  return {
    scope,
    period: scope === "all" ? "all" : period,
    cycles: selected,
    winners,
    losers,
    totalPnlUsd: totals.totalPnlUsd,
    missingFxCount: totals.missingFxCount,
    winRate,
    rewardRisk,
    expectancyR: winRate == null || rewardRisk == null ? null : winRate * rewardRisk - (1 - winRate),
    flatCount: selected.filter((cycle) => Number(cycle.pnl) === 0).length,
  };
}

export function buildMonthlyExpectancyTrend(cycles = []) {
  const activeMonths = [...new Set(cycles.map((cycle) => taipeiDate(cycle.closeAt).slice(0, 7)))].sort();
  if (!activeMonths.length) return [];
  const months = [];
  const cursor = new Date(`${activeMonths[0]}-01T00:00:00Z`);
  const last = new Date(`${activeMonths.at(-1)}-01T00:00:00Z`);
  while (cursor <= last) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months.map((month) => {
    const stats = buildProfitLossTradeStats(cycles, "month", month, null);
    return {
      month,
      sampleCount: stats.cycles.length,
      winnerCount: stats.winners.count,
      loserCount: stats.losers.count,
      winRate: stats.winRate,
      rewardRisk: stats.rewardRisk,
      expectancyR: stats.expectancyR,
    };
  });
}

function usdImpact(amount, currency, usdTwdRate) {
  if (!(Number(amount) > 0)) return 0;
  return pnlToUsd({ [currency || "USD"]: Number(amount) }, usdTwdRate);
}

function firstCandleForCycle(cycle, marketBars) {
  const date = taipeiDate(cycle.openAt);
  return (marketBars || []).find((bar) => bar.symbol === cycle.symbol && bar.date === date);
}

function detectLossAdding(cycle) {
  const entrySide = cycle.direction === "SHORT" ? "SELL" : "BUY";
  let entryQuantity = 0;
  let entryNotional = 0;
  for (const fill of [...(cycle.fills || [])].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))) {
    if (fill.side !== entrySide) continue;
    const average = entryQuantity ? entryNotional / entryQuantity : Number(fill.price);
    if (entryQuantity > 0 && (cycle.direction === "SHORT" ? Number(fill.price) > average : Number(fill.price) < average)) return fill;
    entryQuantity += Number(fill.quantity);
    entryNotional += Number(fill.quantity) * Number(fill.price);
  }
  return null;
}

/** @param {any[]} cycles @param {any[]} marketBars @param {Record<string, any>} reviews @param {any[]} rapidPairs @param {any[]} planHistory @param {number|null} usdTwdRate */
export function detectBehaviorEvents(cycles = [], marketBars = [], reviews = {}, rapidPairs = [], planHistory = [], usdTwdRate = null) {
  const events = [];
  for (const cycle of cycles) {
    const review = reviews[cycle.id] || {};
    const analysis = analyzeCycle(cycle, marketBars, review);
    const entryNotional = Number(cycle.entryNotional) || Number(cycle.averageEntry) * Number(cycle.quantity);
    if (analysis.mfeRetention != null && Number(cycle.mfePct) > 0 && analysis.mfeRetention < 0.5) {
      const nativeImpact = Math.max(0, Number(analysis.maxGiveback || 0) * entryNotional);
      events.push({ id: `behavior:mfe:${cycle.id}`, type: "MFE_GIVEBACK", cycleId: cycle.id, date: taipeiDate(cycle.closeAt), impactUsd: usdImpact(nativeImpact, cycle.currency, usdTwdRate), nativeImpact, currency: cycle.currency, evidence: `MFE ${(Number(cycle.mfePct) * 100).toFixed(1)}%，實際報酬 ${(Number(cycle.returnPct) * 100).toFixed(1)}%`, severity: analysis.mfeRetention < 0 ? 3 : 2 });
    }
    if (analysis.stopDelayCost > 0) events.push({ id: `behavior:stop:${cycle.id}`, type: "STOP_DELAY", cycleId: cycle.id, date: taipeiDate(cycle.closeAt), impactUsd: usdImpact(analysis.stopDelayCost, cycle.currency, usdTwdRate), nativeImpact: analysis.stopDelayCost, currency: cycle.currency, evidence: `延遲成本 ${analysis.stopDelayCost.toFixed(2)} ${cycle.currency}`, severity: 3 });
    const lossAdd = detectLossAdding(cycle);
    if (lossAdd) events.push({ id: `behavior:add:${cycle.id}`, type: "LOSS_ADDING", cycleId: cycle.id, date: taipeiDate(lossAdd.timestamp), impactUsd: 0, nativeImpact: 0, currency: cycle.currency, evidence: `不利價格 ${Number(lossAdd.price).toFixed(2)} 加碼 ${lossAdd.quantity} 股`, severity: 2 });
    const firstBar = firstCandleForCycle(cycle, marketBars);
    const open = validNumber(firstBar?.open);
    if (open > 0) {
      const deviation = cycle.direction === "SHORT" ? open / Number(cycle.averageEntry) - 1 : Number(cycle.averageEntry) / open - 1;
      if (deviation > 0.03) events.push({ id: `behavior:chase:${cycle.id}`, type: "CHASE_ENTRY", cycleId: cycle.id, date: taipeiDate(cycle.openAt), impactUsd: 0, nativeImpact: 0, currency: cycle.currency, evidence: `進場相對當日開盤延伸 ${(deviation * 100).toFixed(1)}%`, severity: 1 });
    }
    const explicitPlan = (planHistory || []).filter((version) => version.cycleId === cycle.id);
    const planCreatedAfterClose = explicitPlan.some((version) => version.createdAt && String(version.createdAt) > String(cycle.closeAt)) || (!explicitPlan.length && review.updatedAt && String(review.updatedAt) > String(cycle.closeAt) && (review.preTradePlan || review.invalidation || Number(review.plannedStop) > 0));
    if (planCreatedAfterClose) events.push({ id: `behavior:posthoc:${cycle.id}`, type: "POST_HOC_PLAN", cycleId: cycle.id, date: taipeiDate(cycle.closeAt), impactUsd: 0, nativeImpact: 0, currency: cycle.currency, evidence: "計畫或理由建立於平倉後", severity: 2 });
  }
  for (const pair of rapidPairs) {
    const next = cycles.find((cycle) => cycle.id === pair.nextCycleId);
    const impact = next && Number(next.pnl) < 0 ? usdImpact(Math.abs(Number(next.pnl)), next.currency, usdTwdRate) : 0;
    events.push({ id: `behavior:repurchase:${pair.previousCycleId}:${pair.nextCycleId}`, type: "RAPID_REPURCHASE", cycleId: pair.nextCycleId, relatedCycleId: pair.previousCycleId, date: next ? taipeiDate(next.openAt) : "", impactUsd: impact, nativeImpact: next && Number(next.pnl) < 0 ? Math.abs(Number(next.pnl)) : 0, currency: next?.currency || "USD", evidence: `${pair.gapTradingDays} 個交易日內重新建倉`, severity: impact > 0 ? 2 : 1 });
  }
  return events.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.severity - a.severity);
}

function planFacts(cycle, reviews, planHistory, marketBars) {
  const review = reviews[cycle.id] || {};
  const versions = (planHistory || []).filter((version) => version.cycleId === cycle.id);
  const hasPlan = Boolean(review.preTradePlan || review.invalidation || versions.length);
  const stopVersions = versions.filter((version) => version.field === "stopLoss" && validNumber(version.value) > 0);
  const hasStop = Number(review.plannedStop) > 0 || stopVersions.length > 0;
  const modified = Number(review.revisedStop) > 0 || stopVersions.length > 1;
  const analysis = analyzeCycle(cycle, marketBars, review);
  const followed = hasStop && !(analysis.stopDelayCost > 0);
  const reviewed = Boolean(review.reflection || review.exitReason);
  return { hasPlan, hasStop, modified, followed, reviewed };
}

export function buildBehaviorDashboard(cycles = [], marketBars = [], reviews = {}, planHistory = [], behaviorEvents = []) {
  const matrices = buildBehaviorMatrices(cycles);
  const facts = cycles.map((cycle) => planFacts(cycle, reviews, planHistory, marketBars));
  const funnel = [
    { key: "total", label: "完整閉環", count: cycles.length },
    { key: "planned", label: "有事前計畫", count: facts.filter((fact) => fact.hasPlan).length },
    { key: "stopped", label: "有初始停損", count: facts.filter((fact) => fact.hasStop).length },
    { key: "unchanged", label: "未擴大規則", count: facts.filter((fact) => fact.hasStop && !fact.modified).length },
    { key: "followed", label: "按規則執行", count: facts.filter((fact) => fact.followed).length },
    { key: "reviewed", label: "完成復盤", count: facts.filter((fact) => fact.reviewed).length },
  ];
  const heatmap = behaviorEvents.reduce((days, event) => {
    if (!event.date) return days;
    const current = days[event.date] || { date: event.date, count: 0, impactUsd: 0, severity: 0, events: [] };
    current.count += 1;
    current.impactUsd += Number(event.impactUsd || 0);
    current.severity = Math.max(current.severity, event.severity || 1);
    current.events.push(event);
    days[event.date] = current;
    return days;
  }, {});
  return { ...matrices, funnel, heatmap: Object.values(heatmap).sort((a, b) => a.date.localeCompare(b.date)) };
}

function qualityLabel(score) {
  if (score == null) return "行情不足";
  if (score >= 0.7) return "位置良好";
  if (score >= 0.4) return "位置普通";
  return "需要改善";
}

function directionalReturn(direction, fromPrice, toPrice) {
  if (!(Number(fromPrice) > 0) || !(Number(toPrice) > 0)) return null;
  const raw = Number(toPrice) / Number(fromPrice) - 1;
  return direction === "SHORT" ? -raw : raw;
}

function average(values) {
  const valid = values.filter((value) => value != null && Number.isFinite(Number(value))).map(Number);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

export function buildTradeQualityAnalysis(cycles = [], marketBars = [], reviews = {}) {
  const tagAnalysis = buildQualityTagAnalysis(cycles, reviews);
  const trades = cycles.map((cycle) => {
    const candles = normalizedCandles(cycle, marketBars);
    const holding = candles.filter((candle) => candle.phase === "HOLDING");
    const holdingLow = holding.length ? Math.min(...holding.map((candle) => candle.low)) : null;
    const holdingHigh = holding.length ? Math.max(...holding.map((candle) => candle.high)) : null;
    const range = holdingLow != null && holdingHigh != null ? holdingHigh - holdingLow : null;
    const entry = validNumber(cycle.averageEntry);
    const exit = validNumber(cycle.averageExit);
    const entryScore = range > 0 && entry != null
      ? Math.max(0, Math.min(1, cycle.direction === "SHORT" ? (entry - holdingLow) / range : (holdingHigh - entry) / range))
      : null;
    const exitScore = range > 0 && exit != null
      ? Math.max(0, Math.min(1, cycle.direction === "SHORT" ? (holdingHigh - exit) / range : (exit - holdingLow) / range))
      : null;
    const entryIndex = candles.findIndex((candle) => candle.date >= taipeiDate(cycle.openAt));
    const thirdDay = entryIndex >= 0 ? candles[entryIndex + 3] : null;
    const postExit = candles.filter((candle) => candle.phase === "POST_EXIT");
    const fifthPostExitDay = postExit[4] || null;
    const analysis = analyzeCycle(cycle, marketBars, reviews[cycle.id] || {});
    const review = reviews[cycle.id] || {};
    return {
      cycleId: cycle.id,
      symbol: cycle.symbol,
      direction: cycle.direction,
      pnl: Number(cycle.pnl) || 0,
      currency: cycle.currency || "USD",
      openDate: taipeiDate(cycle.openAt),
      closeDate: taipeiDate(cycle.closeAt),
      averageEntry: entry,
      averageExit: exit,
      holdingLow,
      holdingHigh,
      entryScore,
      entryLabel: qualityLabel(entryScore),
      entryFollowThrough3: thirdDay ? directionalReturn(cycle.direction, entry, thirdDay.close) : null,
      maePct: validNumber(cycle.maePct),
      exitScore,
      exitLabel: qualityLabel(exitScore),
      mfeRetention: analysis.mfeRetention,
      postExit5: fifthPostExitDay ? directionalReturn(cycle.direction, exit, fifthPostExitDay.close) : null,
      entryReviewed: Boolean(String(review.entryReview || "").trim()),
      exitReviewed: Boolean(String(review.exitReview || "").trim()),
      entryReview: String(review.entryReview || ""),
      exitReview: String(review.exitReview || ""),
      entryQualityTag: normalizeEntryQualityTag(review.entryQualityTag),
      exitQualityTag: normalizeExitQualityTag(review.exitQualityTag),
      exitQualityGroup: exitQualityGroup(cycle),
      qualityRatedAt: review.qualityRatedAt || null,
      precision: candles.length ? "日線近似" : "缺行情",
    };
  });
  const entryScored = trades.filter((trade) => trade.entryScore != null);
  const exitScored = trades.filter((trade) => trade.exitScore != null);
  const entryConfirmed = trades.filter((trade) => trade.entryFollowThrough3 != null);
  const postExitMeasured = trades.filter((trade) => trade.postExit5 != null);
  return {
    trades,
    tagAnalysis,
    summary: {
      total: trades.length,
      averageEntryScore: average(entryScored.map((trade) => trade.entryScore)),
      averageExitScore: average(exitScored.map((trade) => trade.exitScore)),
      goodEntryRate: entryScored.length ? entryScored.filter((trade) => trade.entryScore >= 0.7).length / entryScored.length : null,
      goodExitRate: exitScored.length ? exitScored.filter((trade) => trade.exitScore >= 0.7).length / exitScored.length : null,
      entryFollowThroughRate: entryConfirmed.length ? entryConfirmed.filter((trade) => trade.entryFollowThrough3 > 0).length / entryConfirmed.length : null,
      earlyExitRate: postExitMeasured.length ? postExitMeasured.filter((trade) => trade.postExit5 > 0.03).length / postExitMeasured.length : null,
      averageMae: average(trades.map((trade) => trade.maePct)),
      averageMfeRetention: average(trades.map((trade) => trade.mfeRetention)),
      entryReviewedCount: trades.filter((trade) => trade.entryReviewed).length,
      exitReviewedCount: trades.filter((trade) => trade.exitReviewed).length,
    },
    weakestEntries: entryScored.sort((a, b) => a.entryScore - b.entryScore).slice(0, 5),
    weakestExits: exitScored.sort((a, b) => a.exitScore - b.exitScore).slice(0, 5),
  };
}

function weekIndex(date) {
  return Date.parse(`${taipeiWeekStart(`${date}T00:00:00Z`)}T00:00:00Z`);
}

export function buildCoachFindings(behaviorEvents = []) {
  const groups = new Map();
  for (const event of behaviorEvents) {
    if (!groups.has(event.type)) groups.set(event.type, []);
    groups.get(event.type).push(event);
  }
  return [...groups.entries()].map(([type, events]) => {
    const copy = FINDING_COPY[type] || { title: type, description: "可驗證的重複行為。", trigger: type, action: "檢視證據並建立下一週規則。", metric: "事件次數" };
    const sorted = [...events].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const latestWeek = sorted.length ? Math.max(...sorted.map((event) => weekIndex(event.date))) : 0;
    const currentCount = sorted.filter((event) => weekIndex(event.date) === latestWeek).length;
    const previousCount = sorted.filter((event) => weekIndex(event.date) === latestWeek - 7 * DAY).length;
    const impactUsd = events.reduce((sum, event) => sum + Number(event.impactUsd || 0), 0);
    return {
      type,
      ...copy,
      sampleCount: events.length,
      impactUsd,
      confidence: events.length >= 5 ? "可重複模式" : "待觀察",
      trend: currentCount === previousCount ? "持平" : currentCount > previousCount ? `增加 ${currentCount - previousCount}` : `減少 ${previousCount - currentCount}`,
      evidenceCycleIds: [...new Set(events.flatMap((event) => [event.cycleId, event.relatedCycleId]).filter(Boolean))],
      events,
    };
  }).sort((a, b) => b.impactUsd - a.impactUsd || b.sampleCount - a.sampleCount).slice(0, 3);
}

export function createExperimentFromFinding(finding, now = new Date()) {
  const startDate = now.toISOString().slice(0, 10);
  const endDate = new Date(now.getTime() + 13 * DAY).toISOString().slice(0, 10);
  return {
    id: `experiment-${finding.type.toLowerCase()}-${now.getTime()}`,
    findingType: finding.type,
    title: `改善：${finding.title}`,
    trigger: finding.trigger,
    action: finding.action,
    metric: finding.metric,
    target: "兩週內違規率下降20%",
    startDate,
    endDate,
    status: "ACTIVE",
    baseline: { sampleCount: finding.sampleCount, violationCount: finding.sampleCount, impactUsd: finding.impactUsd },
    evidenceCycleIds: finding.evidenceCycleIds,
    createdAt: now.toISOString(),
    resultNote: "",
  };
}

export function evaluateExperiment(experiment, cycles = [], behaviorEvents = [], asOf = new Date()) {
  const eligible = cycles.filter((cycle) => {
    const date = taipeiDate(cycle.closeAt);
    return date >= experiment.startDate && date <= experiment.endDate;
  });
  const events = behaviorEvents.filter((event) => event.type === experiment.findingType && event.date >= experiment.startDate && event.date <= experiment.endDate);
  const violationRate = eligible.length ? events.length / eligible.length : null;
  const baselineRate = experiment.baseline?.sampleCount ? experiment.baseline.violationCount / experiment.baseline.sampleCount : null;
  const impactUsd = events.reduce((sum, event) => sum + Number(event.impactUsd || 0), 0);
  return {
    eligibleCount: eligible.length,
    violationCount: events.length,
    violationRate,
    baselineRate,
    rateChange: violationRate != null && baselineRate != null ? violationRate - baselineRate : null,
    impactUsd,
    complete: experiment.status === "COMPLETED" || asOf.toISOString().slice(0, 10) > experiment.endDate,
  };
}
