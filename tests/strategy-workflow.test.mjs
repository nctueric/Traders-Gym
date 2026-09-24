import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStrategyConditions, validateStrategyDefinition, selectNoConditions, updateConditionSelection, strategyStagesForCycle } from '../lib/strategy-conditions.mjs';
import { publishStrategyVersion, createStrategyAssignment, buildStrategyAnalysis, buildStrategyComparison, updateStrategyStageReview } from '../lib/strategy-engine.mjs';
import { previewStrategyTransaction } from '../lib/strategy-transaction.mjs';
import { previewEntry, commitEntry } from '../lib/trade-entry.mjs';
import { buildCycles } from '../lib/trade-engine.mjs';
const now='2026-08-28T18:00:00Z';
const rules=[{id:'m1',group:'MARKET_CONDITION',name:'市場一'},{id:'m2',group:'MARKET_CONDITION',name:'市場二'},{id:'e1',group:'ENTRY_TRIGGER',name:'突破'},{id:'e2',group:'ENTRY_TRIGGER',name:'回測'},{id:'x1',group:'EXIT_TRIGGER',name:'出場'},{id:'x2',group:'EXIT_TRIGGER',name:'停損'}];
const makeStrategy=(marketMode='UNRESTRICTED')=>publishStrategyVersion({id:'s',name:'測試策略',versions:[]},rules,'',now,{formatVersion:2,marketMode}).strategy;
const data=()=>({accounts:[{id:'a',currency:'USD'}],fills:[],marketBars:[],cashActivities:[],strategies:[makeStrategy()],strategyAssignments:{}});
const draft=(patch={})=>({formatVersion:2,strategyFormatVersion:2,id:'f1',accountId:'a',market:'NASDAQ',symbol:'AAA',side:'BUY',quantity:10,price:100,fee:0,timestamp:'2026-08-28T15:00:00Z',strategyId:'s',strategyVersionId:'s-v1',strategySelections:{ENTRY:{checks:{e1:'CONFIRMED'},noneGroups:[]}},...patch});
function submit(d,v){const p=previewEntry(d,v,now);return commitEntry(d,{...v,confirmedKey:p.confirmationKey},{quotes:{}},now);}
const accept=(d,v)=>({...v,strategyExceptionKey:previewStrategyTransaction(d,v,previewEntry(d,v,now)).confirmationKey});

test('market ALL, entry/exit ANY, unrestricted skipped, unselected alternatives not failures',()=>{
 const version=makeStrategy('CUSTOM').versions[0];
 assert.deepEqual(evaluateStrategyConditions(version,{checks:{m1:'CONFIRMED',m2:'UNREVIEWED',e1:'CONFIRMED',e2:'NOT_MET'}},'ENTRY').map(g=>g.status),['PENDING','PASS']);
 assert.equal(evaluateStrategyConditions(version,{checks:{m1:'CONFIRMED',m2:'NOT_MET'}},'ENTRY')[0].status,'FAIL');
 assert.deepEqual(evaluateStrategyConditions(makeStrategy().versions[0],{checks:{e2:'CONFIRMED'}},'ENTRY').map(g=>g.status),['SKIPPED','PASS']);
 assert.equal(evaluateStrategyConditions(version,{noneGroups:['EXIT_TRIGGER']},'EXIT')[0].status,'FAIL');
 assert.equal(evaluateStrategyConditions(version,{},'EXIT')[0].status,'PENDING');
 let selection=selectNoConditions({checks:{e1:'CONFIRMED',m1:'CONFIRMED'}},'ENTRY_TRIGGER',rules.filter(r=>r.group==='ENTRY_TRIGGER'),true);
 assert.deepEqual(selection.checks,{m1:'CONFIRMED'});
 selection=updateConditionSelection(selection,'e2',true,'ENTRY_TRIGGER');assert.deepEqual(selection.noneGroups,[]);
 const legacy={rules:version.rules};assert.equal(evaluateStrategyConditions(legacy,{checks:{e1:'CONFIRMED'}},'ENTRY')[1].status,'PENDING');
});

test('publishing validates necessary groups and leaves legacy calls compatible',()=>{
 assert.ok(validateStrategyDefinition('',[]).name);
 assert.ok(validateStrategyDefinition('n',[]).ENTRY_TRIGGER);
 assert.ok(validateStrategyDefinition('n',rules.filter(r=>r.group!=='MARKET_CONDITION'),'CUSTOM').MARKET_CONDITION);
 assert.throws(()=>publishStrategyVersion({id:'x',name:'x'},[],'',now,{formatVersion:2}),/必要條件/);
 assert.equal(publishStrategyVersion({id:'x',name:'x'},[],'',now).version.formatVersion,undefined);
 const first=makeStrategy();const before=JSON.stringify(first.versions[0]);const second=publishStrategyVersion(first,rules.map(r=>({...r,name:r.name+'新'})),'更新',now,{formatVersion:2});assert.equal(JSON.stringify(second.strategy.versions[0]),before);
});

test('unmet/unknown and no strategy require explicit confirmation; selection changes invalidate it',()=>{
 const d=data(), v=draft({strategySelections:{}});assert.throws(()=>submit(d,v),/策略條件需確認/);
 const approved=accept(d,v);assert.equal(submit(d,approved).entryContexts.f1.strategyStages[0].exception,true);
 assert.throws(()=>submit(d,{...approved,strategySelections:{ENTRY:{noneGroups:['ENTRY_TRIGGER']}}}),/策略條件需確認/);
 const unassigned=draft({strategyId:'',strategyVersionId:''});assert.throws(()=>submit(d,unassigned),/未指定策略/);assert.equal(submit(d,accept(d,unassigned)).entryContexts.f1.strategyStages[0].strategyId,null);
 assert.equal(d.fills.length,0);
});

test('add, partial exit and reversal use immutable versions and independent entry/exit snapshots',()=>{
 let d=submit(data(),draft());const initial=JSON.stringify(d.strategyAssignments['cycle-f1']);const original=JSON.stringify(d.entryContexts.f1);
 const changed=publishStrategyVersion(d.strategies[0],rules,'更新',now,{formatVersion:2}).strategy;d={...d,strategies:[changed]};
 d=submit(d,draft({id:'f2',timestamp:'2026-08-28T15:10:00Z',quantity:5,strategyVersionId:'s-v2'}));
 assert.equal(d.entryContexts.f2.strategyStages[0].strategyVersionId,'s-v1');assert.equal(JSON.stringify(d.strategyAssignments['cycle-f1']),initial);
 d=submit(d,draft({id:'f3',timestamp:'2026-08-28T15:20:00Z',side:'SELL',quantity:3,strategySelections:{EXIT:{checks:{x1:'CONFIRMED'}}}}));assert.equal(d.entryContexts.f3.strategyStages[0].phase,'EXIT');
 d=submit(d,draft({id:'f4',timestamp:'2026-08-28T15:30:00Z',side:'SELL',quantity:15,strategyVersionId:'s-v2',strategySelections:{EXIT:{checks:{x2:'CONFIRMED'}},ENTRY:{checks:{e2:'CONFIRMED'}}}}));
 assert.deepEqual(d.entryContexts.f4.strategyStages.map(s=>[s.cycleId,s.phase,s.strategyVersionId]),[['cycle-f1','EXIT','s-v1'],['cycle-f4-open','ENTRY','s-v2']]);
 assert.equal(JSON.stringify(d.entryContexts.f1),original);
 const cycle=buildCycles(d).cycles[0];const before=JSON.stringify(d.entryContexts);let assignment=d.strategyAssignments[cycle.id];
 const stages=strategyStagesForCycle(cycle,d.entryContexts);assert.equal(stages.length,4);
 for(const stage of stages)assignment=updateStrategyStageReview(assignment,stage.id,{checks:{[stage.phase==='ENTRY'?'e1':'x1']:'FOLLOWED'}},now);
 const analysis=buildStrategyAnalysis([cycle,cycle],d.strategies,{[cycle.id]:assignment},{entryContexts:d.entryContexts});assert.equal(analysis.total.count,1);assert.equal(analysis.compliant.count,1);assert.equal(analysis.adherenceRate,1);
 assert.equal(JSON.stringify(d.entryContexts),before);
 const missed=buildStrategyAnalysis([cycle],d.strategies,d.strategyAssignments,{entryContexts:d.entryContexts});assert.equal(missed.reviewedTradeCount,0);
 const failed=updateStrategyStageReview(assignment,stages[2].id,{noneGroups:['EXIT_TRIGGER']},now);assert.equal(buildStrategyAnalysis([cycle],d.strategies,{[cycle.id]:failed},{entryContexts:d.entryContexts}).violated.count,1);
});

test('short reversal unassigned old exit never borrows the new strategy',()=>{
 const d=data();d.fills=[{id:'old',accountId:'a',symbol:'AAA',market:'NASDAQ',currency:'USD',side:'SELL',quantity:3,price:100,fee:0,timestamp:'2026-08-28T14:00:00Z'}];
 const v=draft({quantity:5});const next=submit(d,accept(d,v));assert.equal(next.entryContexts.f1.strategyStages[0].strategyId,null);assert.equal(next.entryContexts.f1.strategyStages[1].strategyId,'s');
});

test('closed comparison deduplicates cycles, includes archived and unassigned, missing FX not zero',()=>{
 const strategy=makeStrategy(),base={id:'c',closeAt:now,openAt:now,currency:'USD',pnl:100,returnPct:.1,entryNotional:1000};
 const assignment=createStrategyAssignment(base,strategy);const cycles=[base,base,{...base,id:'l',pnl:-40,returnPct:-.04},{...base,id:'unknown',pnl:10},{...base,id:'open',closeAt:null}];
 const assignments={c:assignment,l:{...assignment,cycleId:'l'}};
 const rows=buildStrategyComparison(cycles,[{...strategy,status:'ARCHIVED'}],assignments);assert.equal(rows[0].count,2);assert.equal(rows[0].totalPnlUsd,60);assert.equal(rows[0].totalProfitUsd,100);assert.equal(rows[0].totalLossUsd,-40);assert.equal(rows[0].rewardRisk,2.5);assert.equal(rows[0].expectancyR,.75);assert.equal(rows[1].count,1);
 assert.equal(buildStrategyComparison([{...base,currency:'TWD'}],[strategy],assignments)[0].totalPnlUsd,null);
 assert.equal(buildStrategyAnalysis([base],[strategy],assignments).total.averageLoss,null);
});
