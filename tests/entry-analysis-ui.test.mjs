import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTraining } from './render-workspace.mjs';
import { fixtureDataset } from './ui-fixture-data.mjs';
import { summarize } from '../lib/trade-engine.mjs';
import { cycleAnalysisPeriod } from '../lib/coach-engine.mjs';

test('removed entry filters do not restrict remaining analyses or change saved evidence',()=>{
 const data=fixtureDataset('rich'),cycles=summarize(data).cycles;
 const target=cycles.find(c=>c.closeAt.startsWith('2026-08')&&data.strategyAssignments[c.id]?.strategyVersionId==='qa-strategy-v1');
 assert.ok(target);
 const contexts={a:{fillId:'a',cycleId:target.id,fillTimestamp:target.openAt,entrySetup:'BREAKOUT',volumeTags:['RANGE_BREAKOUT'],action:'ENTRY'},b:{fillId:'b',cycleId:target.id,fillTimestamp:target.openAt,entrySetup:'PULLBACK',volumeTags:[],action:'ADD'}};
 for(const [scope,period] of [['all',''],['year','2026'],['month','2026-08'],['week',cycleAnalysisPeriod(target,'week')]]){
  const {calls,html}=renderTraining({filters:[scope,'qa-strategy','qa-strategy-v1',period,'10'],entryContexts:contexts});
  const expected=renderTraining({filters:[scope,'qa-strategy','qa-strategy-v1',period,'10']}).calls.find(call=>call.name==='buildTradeQualityAnalysis').args[0].map(c=>c.id);
  for(const name of ['buildTradeQualityAnalysis','buildBehaviorDashboard','buildProfitLossTradeStats'])assert.deepEqual(calls.find(call=>call.name===name).args[0].map(c=>c.id),expected,`${scope}:${name}`);
  assert.doesNotMatch(html,/成交登錄證據篩選|次已登錄操作/);
  assert.ok(!calls.some(call=>['buildMonthlyExpectancyTrend','buildStrategyAnalysis'].includes(call.name)));
  assert.equal(contexts.a.entrySetup,'BREAKOUT');assert.equal(contexts.b.action,'ADD');
 }
});
