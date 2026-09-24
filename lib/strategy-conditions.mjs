// Shared, pure strategy semantics. Missing legacy metadata keeps the original ALL rule logic.
export const GROUP_LABELS = { MARKET_CONDITION: '市場條件', ENTRY_TRIGGER: '進場條件', EXIT_TRIGGER: '出場條件' };
export const GROUP_KEYS = Object.keys(GROUP_LABELS);
export const RESULT_LABELS = { PASS: '符合', FAIL: '未符合', PENDING: '待確認', SKIPPED: '不限市場' };
export const strategyV2 = version => version?.formatVersion === 2;
export const checkStatus = value => typeof value === 'string' ? value : value?.status || 'UNREVIEWED';
export function conditionApplies(rule, context = {}) {
  if (rule.appliesWhen === 'WINNING_POSITION') return Number(context.pnl) > 0;
  if (rule.appliesWhen === 'LOSING_POSITION') return Number(context.pnl) < 0;
  return true;
}
export function validateStrategyDefinition(name, rules = [], marketMode = 'UNRESTRICTED') {
  /** @type {Record<string, string>} */
  const errors = {};
  if (!String(name || '').trim()) errors.name = '請填寫策略名稱';
  for (const group of GROUP_KEYS) {
    if (group === 'MARKET_CONDITION' && marketMode === 'UNRESTRICTED') continue;
    const items = rules.filter(rule => rule.group === group);
    if (!items.length) errors[group] = '至少新增一項條件';
    for (const rule of items) if (!String(rule.name || '').trim()) errors[rule.id] = '請填寫條件內容';
  }
  return errors;
}
export function evaluateStrategyConditions(version, value = {}, phase = 'ENTRY', context = {}) {
  const groups = phase === 'ENTRY' ? GROUP_KEYS.slice(0, 2) : phase === 'EXIT' ? ['EXIT_TRIGGER'] : GROUP_KEYS;
  return groups.map(group => {
    const rules = (version?.rules || []).filter(rule => rule.group === group && conditionApplies(rule, context));
    const any = strategyV2(version) && group !== 'MARKET_CONDITION';
    const states = rules.map(rule => checkStatus(value.checks?.[rule.id]));
    const good = states.filter(status => ['CONFIRMED', 'FOLLOWED'].includes(status)).length;
    const bad = states.filter(status => ['NOT_MET', 'VIOLATED'].includes(status)).length;
    const pending = states.filter(status => !['CONFIRMED', 'FOLLOWED', 'NOT_MET', 'VIOLATED', 'NOT_APPLICABLE'].includes(status)).length;
    let status = 'PENDING';
    if (strategyV2(version) && group === 'MARKET_CONDITION' && version.marketMode === 'UNRESTRICTED') status = 'SKIPPED';
    else if (any) status = good ? 'PASS' : value.noneGroups?.includes(group) || (rules.length > 0 && bad === rules.length) ? 'FAIL' : 'PENDING';
    else if (bad) status = 'FAIL';
    else if (rules.length && !pending) status = 'PASS';
    return { group, label: GROUP_LABELS[group], status, any, rules, selectedCount: good, pendingCount: status === 'PENDING' ? Math.max(1, any ? 1 : pending) : 0 };
  });
}
export function updateConditionSelection(value = {}, ruleId, selected, group, audit = false) {
  return { ...value, checks: { ...value.checks, [ruleId]: selected ? audit ? 'FOLLOWED' : 'CONFIRMED' : 'UNREVIEWED' }, noneGroups: (value.noneGroups || []).filter(key => key !== group) };
}
export function selectNoConditions(value = {}, group, rules, selected) {
  const checks = { ...value.checks };
  for (const rule of rules) delete checks[rule.id];
  return { ...value, checks, noneGroups: [...(value.noneGroups || []).filter(key => key !== group), ...(selected ? [group] : [])] };
}

// Enumerate each real operation once; reversals have separate close/open split fills.
export function strategyStagesForCycle(cycle, contexts = {}) {
  const stages = Object.values(contexts).flatMap(context => (context.strategyStages || []).filter(stage => stage.cycleId === cycle.id).map(stage => ({ ...stage, fillTimestamp: context.fillTimestamp, recordedAt: context.recordedAt })));
  for (const fill of cycle.fills || []) {
    const fillId = fill.originalFillId || fill.id;
    const phase = fill.side === (cycle.direction === 'SHORT' ? 'SELL' : 'BUY') ? 'ENTRY' : 'EXIT';
    if (!stages.some(stage => stage.fillId === fillId && stage.phase === phase)) stages.push({ id: `${fillId}:${phase}`, fillId, cycleId: cycle.id, phase, fillTimestamp: fill.timestamp, missing: true });
  }
  if (!stages.length) for (const phase of ['ENTRY', 'EXIT']) stages.push({ id: `legacy:${cycle.id}:${phase}`, cycleId: cycle.id, phase, missing: true });
  return stages.sort((a, b) => String(a.fillTimestamp || '').localeCompare(String(b.fillTimestamp || '')) || a.id.localeCompare(b.id));
}
