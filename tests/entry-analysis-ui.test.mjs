import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTraining } from './render-workspace.mjs';
import { fixtureDataset } from './ui-fixture-data.mjs';
import { summarize } from '../lib/trade-engine.mjs';
import { cycleAnalysisPeriod } from '../lib/coach-engine.mjs';

test('entry filters share exact closed-cycle samples across quality, matrices, profit structure and rule audit',()=>{
 const data=fixtureDataset('rich'),cycles=summarize(data).cycles;
 const target=cycles.find(c=>c.closeAt.startsWith('2026-08')&&data.strategyAssignments[c.id]?.strategyVersionId==='qa-strategy-v1');
 assert.ok(target);
 const contexts={a:{fillId:'a',cycleId:target.id,fillTimestamp:target.openAt,entrySetup:'BREAKOUT',volumeTags:['RANGE_BREAKOUT'],action:'ENTRY'},b:{fillId:'b',cycleId:target.id,fillTimestamp:target.openAt,entrySetup:'PULLBACK',volumeTags:[],action:'ADD'}};
 for(const [scope,period] of [['all',''],['year','2026'],['month','2026-08'],['week',cycleAnalysisPeriod(target,'week')]]){
  const {calls,html}=renderTraining({filters:[scope,'qa-strategy','qa-strategy-v1',period,'10','BREAKOUT','RANGE_BREAKOUT','yes'],entryContexts:contexts});
  for(const name of ['buildTradeQualityAnalysis','buildBehaviorDashboard','buildProfitLossTradeStats','buildStrategyAnalysis'])assert.deepEqual(calls.find(call=>call.name===name).args[0].map(c=>c.id),[target.id],`${scope}:${name}`);
  assert.match(html,/1 個閉環・2 次已登錄操作/);
  assert.deepEqual(calls.find(call=>call.name==='buildMonthlyExpectancyTrend').args[0].map(c=>c.id),[target.id]);
 }
 const none=renderTraining({filters:['all','','','','0','CONTINUATION','',''],entryContexts:contexts});assert.equal(none.calls.find(call=>call.name==='buildProfitLossTradeStats').args[0].length,0);
});
