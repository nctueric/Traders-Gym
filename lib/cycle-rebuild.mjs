import { buildCycles } from './trade-engine.mjs';
const clone = value => JSON.parse(JSON.stringify(value));
const cycles = data => { const result = buildCycles({ fills: data.fills || [], marketBars: [] }); return [...result.cycles, ...result.positions]; };
const originalId = fill => fill.originalFillId || fill.id;

// Reconcile associations only. Saved execution snapshots are retained in the audit record.
export function reconcileBackdatedCycles(previous, updated, fillId, timestamp) {
  const before = cycles(previous), after = cycles(updated);
  const destinations = new Map(before.map(old => [old.id, after.filter(next => next.accountId === old.accountId && next.symbol === old.symbol && next.direction === old.direction && next.fills.some(fill => old.fills.some(prior => originalId(prior) === originalId(fill)))).map(next => next.id)]));
  const sources = new Map();
  for (const [id, targets] of destinations) for (const target of targets) sources.set(target, [...(sources.get(target) || []), id]);
  const changes = before.filter(old => {
    const targets = destinations.get(old.id);
    return targets.length !== 1 || targets[0] !== old.id || sources.get(targets[0]).length > 1;
  }).map(old => ({ from: old.id, to: destinations.get(old.id), symbol: old.symbol, automatic: destinations.get(old.id).length === 1 && sources.get(destinations.get(old.id)[0]).length === 1 }));
  if (!changes.length) return updated;
  const changed = new Map(changes.map(change => [change.from, change]));
  const remap = id => changed.has(id) ? (changed.get(id).automatic ? changed.get(id).to[0] : null) : id;
  const result = { ...updated };
  const original = {};
  for (const field of ['cycleReviews', 'strategyAssignments', 'positionPlans']) {
    original[field] = clone(previous[field] || {});
    const values = { ...(updated[field] || {}) };
    const moved = [];
    for (const change of changes) if (Object.hasOwn(values, change.from)) {
      const value = values[change.from]; delete values[change.from];
      if (change.automatic) moved.push([change.to[0], value]);
    }
    for (const [target, value] of moved) if (!Object.hasOwn(values, target)) values[target] = { ...value, ...(value.cycleId ? { cycleId: target } : {}) };
    result[field] = values;
  }
  for (const field of ['planHistory', 'decisionLinkHistory']) {
    original[field] = clone(previous[field] || []);
    result[field] = (updated[field] || []).flatMap(row => {
      const target = remap(row.cycleId);
      if (row.pairKey) { const pair = row.pairKey.split('>').map(remap); return pair.every(Boolean) && new Set(pair).size === pair.length ? [{ ...row, pairKey: pair.join('>') }] : []; }
      return row.cycleId && !target ? [] : [{ ...row, ...(row.cycleId ? { cycleId: target } : {}) }];
    });
  }
  original.decisionLinks = clone(previous.decisionLinks || {});
  result.decisionLinks = {};
  for (const [key, value] of Object.entries(updated.decisionLinks || {})) {
    const pair = key.split('>').map(remap);
    if (pair.every(Boolean) && new Set(pair).size === pair.length) result.decisionLinks[pair.join('>')] = value;
  }
  original.entryContexts = clone(previous.entryContexts || {});
  result.entryContexts = Object.fromEntries(Object.entries(updated.entryContexts || {}).map(([key, context]) => {
    const locate = (id, phase) => {
      if (!changed.has(id)) return id;
      const matched = after.filter(cycle => cycle.fills.some(fill => originalId(fill) === (context.fillId || key) && (!fill.splitRole || fill.splitRole === (phase === 'EXIT' ? 'CLOSE' : 'OPEN'))));
      return matched.length === 1 ? matched[0].id : remap(id);
    };
    return [key, { ...context, originalCycleId: context.originalCycleId || null,
      cycleId: locate(context.cycleId, context.action === 'EXIT' || context.action === 'REDUCE' ? 'EXIT' : 'ENTRY') || null,
      ...(context.strategyStages ? { strategyStages: context.strategyStages.map(stage => ({ ...stage, originalCycleId: stage.originalCycleId || stage.cycleId, cycleId: locate(stage.cycleId, stage.phase) || null })) } : {}) }];
  }));
  result.cycleRebuildHistory = [...(updated.cycleRebuildHistory || []), { id: `rebuild-${fillId}`, fillId, timestamp, changes, original }];
  return result;
}
