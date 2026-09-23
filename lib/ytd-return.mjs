import { buildMonthlyAssetPoint } from './monthly-assets.mjs';
import { pnlToUsd } from './quote-engine.mjs';

// Modified Dietz estimate, using the same current FX basis as the asset overview.
export function buildYtdReturn(data, currentEquity, rate, now = new Date()) {
  return buildPeriodReturn(data, currentEquity, rate, now, false);
}

export function buildMonthReturn(data, currentEquity, rate, now = new Date()) {
  return buildPeriodReturn(data, currentEquity, rate, now, true);
}

export function buildWeekReturn(data, currentEquity, rate, now = new Date()) {
  return buildPeriodReturn(data, currentEquity, rate, now, "week");
}

function buildPeriodReturn(data, currentEquity, rate, now, monthly) {
  const year = now.getUTCFullYear();
  const weekly = monthly === "week";
  const monday = Date.UTC(year, now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  const start = weekly ? monday : Date.UTC(year, monthly ? now.getUTCMonth() : 0, 1), end = now.getTime();
  const previousMonth = new Date(start - 1).toISOString().slice(0, 7);
  const prefix = weekly ? "週初" : monthly ? "月初" : "年初";
  const baseline = buildMonthlyAssetPoint(data, previousMonth, rate, {}, now, weekly ? new Date(start - 1) : null);
  const problems = baseline.problems.map(p => `${prefix}估值：${p}`);
  if (baseline.estimatedSymbols.length) problems.push(`${prefix}持倉缺歷史行情`);
  if (baseline.staleSymbols.length) problems.push(`${prefix}持倉行情超過七天未更新`);
  if (!(baseline.totalUsd > 0)) problems.push(`缺有效${prefix}資產`);
  if (currentEquity.totalUsd == null || !Number.isFinite(currentEquity.totalUsd)) problems.push('缺目前資產估值');
  if (currentEquity.unpricedPositionCount) problems.push('目前持倉缺估值');
  let flows = 0, weightedFlows = 0;
  const allowed = ['DEPOSIT','WITHDRAWAL','DIVIDEND','INTEREST','FEE','TAX'];
  for (const activity of data.cashActivities || []) {
    const time = Date.parse(activity.timestamp);
    if (!Number.isFinite(time)) { problems.push('資金活動日期無效'); continue; }
    if (time < start || time > end) continue;
    const type = String(activity.type).toUpperCase();
    if (activity.requiresReview || !allowed.includes(type)) { problems.push(type === 'OPENING_BALANCE' ? '期間內有期初餘額校正，需核對後才能計算報酬率' : '期間內資金活動待確認'); continue; }
    if (!['DEPOSIT','WITHDRAWAL'].includes(type)) continue;
    const amount = Number(activity.amount);
    if (activity.amount == null || !Number.isFinite(amount) || amount < 0) { problems.push('入出金金額無效'); continue; }
    if (!['USD','TWD'].includes(activity.currency)) { problems.push('入出金幣別不支援'); continue; }
    const usd = pnlToUsd({[activity.currency]:amount},rate);
    if (usd == null || !Number.isFinite(usd)) { problems.push('入出金缺換算匯率或幣別'); continue; }
    const flow = usd * (type === 'WITHDRAWAL' ? -1 : 1);
    flows += flow;
    weightedFlows += flow * (end > start ? (end - time) / (end - start) : 0);
  }
  const denominator = baseline.totalUsd == null ? null : baseline.totalUsd + weightedFlows;
  if (!(denominator > 0)) problems.push('加權投入資金不大於零');
  const profit = currentEquity.totalUsd == null || baseline.totalUsd == null ? null : currentEquity.totalUsd - baseline.totalUsd - flows;
  const result = profit == null || !(denominator > 0) ? null : profit / denominator;
  if (result != null && !Number.isFinite(result)) problems.push('報酬率無法計算');
  return { year, rate: problems.length ? null : result, profitUsd: problems.length ? null : profit, baselineUsd: baseline.totalUsd, netFlowsUsd: flows, problems:[...new Set(problems)] };
}

export function monthlyReturnSignal(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return { tone: 'unknown', label: '缺資料' };
  if (rate > 0.30) return { tone: 'exceptional', label: '紫色：當月報酬率 > +30%' };
  if (rate <= -0.10) return { tone: 'critical', label: '深紅警示：當月報酬率 ≤ −10%' };
  if (rate <= -0.08) return { tone: 'danger', label: '紅色警示：當月報酬率 ≤ −8%' };
  if (rate <= -0.05) return { tone: 'warning', label: '橘色警示：當月報酬率 ≤ −5%' };
  return { tone: 'normal', label: '未達警示門檻' };
}
