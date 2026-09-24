import { evaluateStrategyConditions, strategyStagesForCycle, strategyV2, validateStrategyDefinition } from './strategy-conditions.mjs';
import { pnlToUsd } from "./quote-engine.mjs";

export const STRATEGY_GROUPS = ["MARKET_CONDITION", "ENTRY_TRIGGER", "EXIT_TRIGGER"];
export const PRE_TRADE_STATUSES = ["CONFIRMED", "NOT_MET", "UNREVIEWED"];
export const POST_TRADE_STATUSES = ["FOLLOWED", "VIOLATED", "NOT_APPLICABLE", "UNREVIEWED"];

export function normalizeStrategyDataset(dataset = {}) {
  return {
    ...dataset,
    strategies: Array.isArray(dataset.strategies) ? dataset.strategies : [],
    strategyAssignments: dataset.strategyAssignments && typeof dataset.strategyAssignments === "object" ? dataset.strategyAssignments : {},
  };
}

export function normalizeStrategyRule(rule, index = 0) {
  const group = STRATEGY_GROUPS.includes(rule?.group) ? rule.group : "ENTRY_TRIGGER";
  const appliesWhen = group === "EXIT_TRIGGER" && ["WINNING_POSITION", "LOSING_POSITION"].includes(rule?.appliesWhen) ? rule.appliesWhen : "ALWAYS";
  return {
    id: String(rule?.id || `rule-${Date.now()}-${index}`),
    group,
    name: String(rule?.name || "").trim(),
    criterion: String(rule?.criterion || "").trim(),
    checkpoint: String(rule?.checkpoint || (group === "MARKET_CONDITION" ? "BEFORE_ENTRY" : group === "ENTRY_TRIGGER" ? "AT_ENTRY" : "AT_EXIT")),
    appliesWhen,
    note: String(rule?.note || "").trim(),
    order: Number.isFinite(Number(rule?.order)) ? Number(rule.order) : index,
  };
}

export function createStrategy({ name, description = "", rules = [] }, now = new Date().toISOString()) {
  const id = `strategy-${Date.now()}`;
  return { id, name: String(name).trim(), description: String(description).trim(), status: "DRAFT", versions: [], draftRules: rules.map(normalizeStrategyRule), createdAt: now, updatedAt: now };
}

export function publishStrategyVersion(strategy, rules, changeReason, now = new Date().toISOString(), options = {}) {
  if (options.formatVersion === 2 && Object.keys(validateStrategyDefinition(strategy.name, rules, options.marketMode)).length) throw new Error("請完成名稱與必要條件後再啟用");
  const versionNumber = (strategy.versions || []).length + 1;
  const version = {
    ...(options.formatVersion === 2 ? { formatVersion: 2, marketMode: options.marketMode || "UNRESTRICTED", name: strategy.name, description: strategy.description } : {}),
    id: `${strategy.id}-v${versionNumber}`,
    strategyId: strategy.id,
    version: versionNumber,
    changeReason: String(changeReason || (versionNumber === 1 ? "首次啟用" : "規則更新")).trim(),
    rules: rules.map(normalizeStrategyRule),
    createdAt: now,
  };
  return { strategy: { ...strategy, status: "ACTIVE", versions: [...(strategy.versions || []), version], draftRules: version.rules.map((rule) => ({ ...rule })), activeVersionId: version.id, updatedAt: now }, version };
}

export function activeStrategyVersion(strategy) {
  return (strategy?.versions || []).find((version) => version.id === strategy.activeVersionId) || strategy?.versions?.at(-1) || null;
}

export function findStrategyVersion(strategies, strategyId, versionId) {
  const strategy = (strategies || []).find((item) => item.id === strategyId);
  return { strategy, version: (strategy?.versions || []).find((item) => item.id === versionId) || null };
}

export function createStrategyAssignment(cycle, strategy, source = "OPEN_POSITION", now = new Date().toISOString()) {
  const version = activeStrategyVersion(strategy);
  if (!version) throw new Error("策略尚未啟用");
  const preChecks = {};
  const postChecks = {};
  for (const rule of version.rules || []) {
    if (rule.group !== "EXIT_TRIGGER") preChecks[rule.id] = { status: "UNREVIEWED", note: "", checkedAt: null };
    postChecks[rule.id] = { status: "UNREVIEWED", note: "", checkedAt: null };
  }
  return { cycleId: cycle.id, strategyId: strategy.id, strategyVersionId: version.id, assignedAt: now, source, lateAssignment: String(now) > String(cycle.openAt), preChecks, postChecks, updatedAt: now };
}

export function updateStrategyCheck(assignment, phase, ruleId, status, note = "", now = new Date().toISOString()) {
  const allowed = phase === "pre" ? PRE_TRADE_STATUSES : POST_TRADE_STATUSES;
  if (!allowed.includes(status)) throw new Error("規則狀態無效");
  const key = phase === "pre" ? "preChecks" : "postChecks";
  return { ...assignment, [key]: { ...(assignment[key] || {}), [ruleId]: { status, note: String(note), checkedAt: status === "UNREVIEWED" ? null : now } }, updatedAt: now };
}

export function ruleApplies(rule, cycle) {
  if (rule.appliesWhen === "WINNING_POSITION") return Number(cycle.pnl) > 0;
  if (rule.appliesWhen === "LOSING_POSITION") return Number(cycle.pnl) < 0;
  return true;
}

function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }

function cohortStats(rows, usdTwdRate) {
  const winners = rows.filter((row) => Number(row.cycle.pnl) > 0);
  const losers = rows.filter((row) => Number(row.cycle.pnl) < 0);
  const winRate = winners.length + losers.length ? winners.length / (winners.length + losers.length) : null;
  const averageWin = average(winners.filter(row => row.cycle.returnPct != null).map((row) => Number(row.cycle.returnPct)).filter(Number.isFinite));
  const averageLoss = average(losers.filter(row => row.cycle.returnPct != null).map((row) => Number(row.cycle.returnPct)).filter(Number.isFinite));
  const rewardRisk = averageWin != null && averageLoss != null && averageLoss < 0 ? averageWin / Math.abs(averageLoss) : null;
  const pnlUsd = rows.map((row) => pnlToUsd({ [row.cycle.currency || "USD"]: Number(row.cycle.pnl) }, usdTwdRate));
  const entryUsd = rows.map((row) => pnlToUsd({ [row.cycle.currency || "USD"]: Number(row.cycle.entryNotional) }, usdTwdRate));
  const missingFx = pnlUsd.some((value) => value == null) || entryUsd.some((value) => value == null);
  return {
    count: rows.length,
    averageWin, averageLoss,
    totalProfitUsd: missingFx ? null : pnlUsd.filter(value => value > 0).reduce((sum, value) => sum + value, 0),
    totalLossUsd: missingFx ? null : pnlUsd.filter(value => value < 0).reduce((sum, value) => sum + value, 0),
    winRate,
    rewardRisk,
    expectancyR: winRate == null || rewardRisk == null ? null : winRate * rewardRisk - (1 - winRate),
    averageEntryNotionalUsd: missingFx ? null : average(entryUsd),
    totalPnlUsd: missingFx ? null : pnlUsd.reduce((sum, value) => sum + value, 0),
    missingFx,
  };
}

/** @param {{strategyId?: string, versionId?: string, usdTwdRate?: number|null, entryContexts?: Record<string, any>}} [options] */
export function buildStrategyAnalysis(cycles = [], strategies = [], assignments = {}, { strategyId = "", versionId = "", usdTwdRate = /** @type {number|null} */ (null), entryContexts = {} } = {}) {
  const rows = [...new Map(cycles.filter(cycle => cycle.closeAt).map(cycle => [cycle.id, cycle])).values()].map((cycle) => {
    const assignment = assignments?.[cycle.id];
    if (!assignment || strategyId && assignment.strategyId !== strategyId || versionId && assignment.strategyVersionId !== versionId) return null;
    const { strategy, version } = findStrategyVersion(strategies, assignment.strategyId, assignment.strategyVersionId);
    if (!strategy || !version) return null;
    const rules = (version.rules || []).filter((rule) => ruleApplies(rule, cycle));
    const checks = rules.map((rule) => ({ rule, ...(assignment.postChecks?.[rule.id] || { status: "UNREVIEWED", note: "", checkedAt: null }) }));
    if (strategyV2(version)) {
      const stages = strategyStagesForCycle(cycle, entryContexts);
      const groups = stages.flatMap(stage => evaluateStrategyConditions(stage.versionSnapshot || version, assignment.stageReviews?.[stage.id] || {}, stage.phase, stage.conditionContext || cycle).filter(group => group.status !== 'SKIPPED').map(group => ({ ...group, stageId: stage.id })));
      const reviewed = groups.length > 0 && groups.every(group => group.status !== 'PENDING');
      const violated = groups.some(group => group.status === 'FAIL');
      return { cycle, strategy, version, assignment, checks: [], groups, stages, reviewed, violated, fullCompliance: reviewed && !violated };
    }
    const reviewed = checks.length > 0 && checks.every((check) => ["FOLLOWED", "VIOLATED", "NOT_APPLICABLE"].includes(check.status));
    const violated = checks.some((check) => check.status === "VIOLATED");
    const fullCompliance = reviewed && !violated && checks.some((check) => check.status === "FOLLOWED");
    return { cycle, strategy, version, assignment, checks, reviewed, violated, fullCompliance };
  }).filter(Boolean);
  const ruleMap = new Map();
  for (const row of rows) for (const check of row.checks) {
    const key = `${row.version.id}:${check.rule.id}`;
    const current = ruleMap.get(key) || { key, strategyId: row.strategy.id, versionId: row.version.id, ruleId: check.rule.id, strategyName: row.strategy.name, ruleName: check.rule.name, group: check.rule.group, applicableCount: 0, followedCount: 0, violationCount: 0, unreviewedCount: 0, violationPnlUsd: 0, missingFx: false, evidenceCycleIds: [] };
    current.applicableCount += check.status === "NOT_APPLICABLE" ? 0 : 1;
    if (check.status === "FOLLOWED") current.followedCount += 1;
    if (check.status === "VIOLATED") {
      current.violationCount += 1;
      current.evidenceCycleIds.push(row.cycle.id);
      const value = pnlToUsd({ [row.cycle.currency || "USD"]: Number(row.cycle.pnl) }, usdTwdRate);
      if (value == null) current.missingFx = true; else current.violationPnlUsd += value;
    }
    if (check.status === "UNREVIEWED") current.unreviewedCount += 1;
    ruleMap.set(key, current);
  }
  const reviewedChecks = rows.flatMap((row) => row.checks).filter((check) => ["FOLLOWED", "VIOLATED"].includes(check.status));
  const reviewedGroups = rows.flatMap(row => row.groups || []).filter(group => group.status !== 'PENDING');
  const followedChecks = reviewedChecks.filter((check) => check.status === "FOLLOWED").length + reviewedGroups.filter(group => group.status === 'PASS').length;
  const reviewedRows = rows.filter((row) => row.reviewed);
  return {
    rows,
    total: cohortStats(rows, usdTwdRate),
    compliant: cohortStats(rows.filter((row) => row.fullCompliance), usdTwdRate),
    violated: cohortStats(rows.filter((row) => row.violated), usdTwdRate),
    reviewCoverage: rows.length ? reviewedRows.length / rows.length : null,
    adherenceRate: reviewedChecks.length + reviewedGroups.length ? followedChecks / (reviewedChecks.length + reviewedGroups.length) : null,
    fullComplianceRate: reviewedRows.length ? reviewedRows.filter((row) => row.fullCompliance).length / reviewedRows.length : null,
    reviewedTradeCount: reviewedRows.length,
    sampleState: reviewedRows.length >= 20 ? "ESTABLISHED" : "OBSERVING",
    rules: [...ruleMap.values()].map((rule) => ({ ...rule, adherenceRate: rule.followedCount + rule.violationCount ? rule.followedCount / (rule.followedCount + rule.violationCount) : null, violationPnlUsd: rule.missingFx ? null : rule.violationPnlUsd })).sort((a, b) => b.violationCount - a.violationCount || a.ruleName.localeCompare(b.ruleName)),
  };
}

export function strategyReplayEvents(cycle, strategies = [], assignments = {}) {
  const assignment = assignments?.[cycle.id];
  if (!assignment) return [];
  const { strategy, version } = findStrategyVersion(strategies, assignment.strategyId, assignment.strategyVersionId);
  if (!strategy || !version) return [];
  const events = [{ id: `strategy:${cycle.id}`, type: "STRATEGY_ASSIGNED", date: assignment.assignedAt?.slice(0, 10) || null, timestamp: assignment.assignedAt || null, price: null, label: `策略：${strategy.name}`, detail: `版本 ${version.version}${assignment.lateAssignment ? "・事後指派" : ""}`, note: version.changeReason, source: "STRATEGY", sortOrder: 210 }];
  for (const rule of version.rules || []) {
    const check = assignment.postChecks?.[rule.id];
    if (!check || !["FOLLOWED", "VIOLATED"].includes(check.status)) continue;
    events.push({ id: `strategy-rule:${cycle.id}:${rule.id}`, type: check.status === "VIOLATED" ? "RULE_VIOLATED" : "RULE_FOLLOWED", date: check.checkedAt?.slice(0, 10) || cycle.closeAt?.slice(0, 10), timestamp: check.checkedAt || cycle.closeAt, price: null, label: `${check.status === "VIOLATED" ? "違反" : "遵守"}：${rule.name}`, detail: rule.criterion, note: check.note || "", source: "STRATEGY", sortOrder: 410 });
  }
  for (const [stageId, review] of Object.entries(assignment.stageReviews || {})) {
    if (!review.checkedAt) continue;
    events.push({ id: `strategy-stage:${cycle.id}:${stageId}`, type: 'STRATEGY_REVIEW', date: review.checkedAt.slice(0,10), timestamp: review.checkedAt, price: null, label: stageId.startsWith('followup:') ? '後續策略確認' : '逐次策略複盤', detail: `${strategy.name} · ${stageId}`, note: review.note || '', source: 'STRATEGY', sortOrder: 415 });
  }
  return events;
}

export function updateStrategyStageReview(assignment, stageId, value, now = new Date().toISOString()) {
  return { ...assignment, stageReviews: { ...assignment.stageReviews, [stageId]: { checks: { ...value.checks }, noneGroups: [...(value.noneGroups || [])], checkedAt: now, note: String(value.note || '') } }, updatedAt: now };
}
export function buildStrategyComparison(cycles, strategies, assignments, options = {}) {
  const closed = [...new Map(cycles.filter(cycle => cycle.closeAt).map(cycle => [cycle.id, cycle])).values()];
  const rows = strategies.filter(strategy => strategy.status !== 'ARCHIVED' || closed.some(cycle => assignments[cycle.id]?.strategyId === strategy.id)).map(strategy => ({ id: strategy.id, name: strategy.name, status: strategy.status, ...buildStrategyAnalysis(closed, strategies, assignments, { ...options, strategyId: strategy.id }).total }));
  const unassigned = closed.filter(cycle => !assignments[cycle.id] || !findStrategyVersion(strategies, assignments[cycle.id].strategyId, assignments[cycle.id].strategyVersionId).version);
  if (unassigned.length) rows.push({ id: '', name: '未指定策略', status: 'UNASSIGNED', ...cohortStats(unassigned.map(cycle => ({ cycle })), options.usdTwdRate) });
  return rows;
}
