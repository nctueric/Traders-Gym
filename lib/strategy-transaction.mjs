import { activeStrategyVersion, findStrategyVersion } from './strategy-engine.mjs';
import { evaluateStrategyConditions, strategyV2 } from './strategy-conditions.mjs';
const clone = value => JSON.parse(JSON.stringify(value));

export function previewStrategyTransaction(data, draft, preview) {
  if (!preview.fill || !preview.action) return { stages: [], warnings: [], confirmationKey: '', enforce: false };
  const stages = [];
  function add(phase, cycle, assignment, value) {
    const strategy = assignment ? findStrategyVersion(data.strategies, assignment.strategyId, assignment.strategyVersionId).strategy : phase === 'ENTRY' ? (data.strategies || []).find(item => item.id === draft.strategyId) : null;
    const version = assignment ? findStrategyVersion(data.strategies, assignment.strategyId, assignment.strategyVersionId).version : strategy?.versions?.find(item => item.id === draft.strategyVersionId);
    const pnl = phase === 'EXIT' && preview.before ? (preview.before.direction === 'SHORT' ? -1 : 1) * (preview.fill.price - preview.before.averageCost) * preview.before.quantity : 0;
    const conditionContext = { pnl };
    const fallback = phase === 'ENTRY' ? draft.ruleChecks || {} : draft.exitRuleChecks || {};
    const selection = { checks: { ...(value?.checks || fallback) }, noneGroups: [...(value?.noneGroups || [])] };
    stages.push({ id: `${draft.id}:${phase}`, fillId: draft.id, cycleId: cycle.id, phase, strategyId: strategy?.id || null, strategyName: version?.name || strategy?.name || null, strategyVersionId: version?.id || null, versionSnapshot: version ? clone(version) : null, conditionContext, selection, groups: version ? evaluateStrategyConditions(version, selection, phase, conditionContext) : [], inherited: !!assignment });
  }
  if (['REDUCE', 'EXIT', 'REVERSAL'].includes(preview.action)) add('EXIT', preview.before, data.strategyAssignments?.[preview.before.id], draft.strategySelections?.EXIT);
  if (['ENTRY', 'ADD', 'REVERSAL'].includes(preview.action)) add('ENTRY', preview.after, preview.assignment, draft.strategySelections?.ENTRY);
  const warnings = stages.flatMap(stage => !stage.versionSnapshot ? [`${stage.phase === 'ENTRY' ? '進場' : '出場'}：未指定策略`] : stage.groups.filter(group => ['FAIL', 'PENDING'].includes(group.status)).map(group => `${group.label}：${group.status === 'FAIL' ? '未符合' : '待確認'}`));
  const confirmationKey = JSON.stringify([preview.confirmationKey, stages.map(stage => [stage.cycleId, stage.phase, stage.versionSnapshot, stage.selection])]);
  return { stages, warnings, confirmationKey, enforce: draft.strategyFormatVersion === 2 || stages.some(stage => strategyV2(stage.versionSnapshot)) };
}
export function snapshotStrategyTransaction(data, draft, preview, now) {
  const result = previewStrategyTransaction(data, draft, preview);
  for (const stage of result.stages) {
    if (!stage.inherited && stage.phase === 'ENTRY' && draft.strategyId) {
      const strategy = data.strategies?.find(item => item.id === draft.strategyId);
      if (strategy?.status !== 'ACTIVE' || activeStrategyVersion(strategy)?.id !== draft.strategyVersionId) throw new Error('策略版本已更新或停用，請重新選擇並確認');
    }
    const allowed = ['CONFIRMED', 'NOT_MET', 'UNREVIEWED'];
    if (Object.values(stage.selection.checks).some(value => !allowed.includes(typeof value === 'string' ? value : value?.status))) throw new Error('策略條件確認狀態無效');
  }
  if (result.enforce && result.warnings.length && draft.strategyExceptionKey !== result.confirmationKey) throw new Error(`策略條件需確認：${result.warnings.join('；')}。請確認仍登錄實際成交。`);
  return result.stages.map(stage => ({ ...stage, confirmedAt: now, exception: result.warnings.length > 0 && draft.strategyExceptionKey === result.confirmationKey, exceptionConfirmedAt: result.warnings.length && draft.strategyExceptionKey === result.confirmationKey ? now : null }));
}
