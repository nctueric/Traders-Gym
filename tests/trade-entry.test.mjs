import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntryDraft, previewEntry, commitEntry, buildEntryEvidence, entryValuation, marketDate, entryEvidenceKey, filterCyclesByEntry, contextsForCycle } from '../lib/trade-entry.mjs';
import { buildCycles } from '../lib/trade-engine.mjs';
import { buildCycleReplay } from '../lib/coach-engine.mjs';
import { publishStrategyVersion, createStrategyAssignment } from '../lib/strategy-engine.mjs';
import {cloudStore} from './cloud-store.mjs';
import { completeTradeJson } from '../lib/trade-record-store.mjs';

export const now='2026-08-28T18:00:00.000Z';
export const fill=(id,side,quantity,price,timestamp='2026-08-27T15:00:00.000Z')=>({id,accountId:'usd',market:'NASDAQ',currency:'USD',symbol:'AAA',side,quantity,price,fee:0,timestamp});
export const fixture=()=>({version:'1',profile:{name:'測試'},settings:{quoteProvider:'json'},accounts:[{id:'usd',currency:'USD',name:'美股'},{id:'twd',currency:'TWD',name:'台股'}],fills:[],cashActivities:[{id:'cash',type:'DEPOSIT',currency:'USD',amount:100000,timestamp:'2026-01-01T00:00:00Z'}],marketBars:[],strategies:[],strategyAssignments:{},planHistory:[],positionPlans:{},cycleReviews:{}});
export const snapshot=()=>({capturedAt:now,quotes:{AAA:{symbol:'AAA',price:120,currency:'USD',updatedAt:now},'USDTWD=X':{price:32,updatedAt:now}}});
export function draft(data,patch={}) {return {...createEntryDraft(data.accounts,now,'new'),symbol:'AAA',quantity:'10',price:'110',timestamp:'2026-08-28T17:00:00.000Z',...patch};}
export function submit(data,entry,snap=snapshot(),at=now) {const preview=previewEntry(data,entry,at);return commitEntry(data,{...entry,confirmedKey:preview.confirmationKey},snap,at);}

test('long and short entry/add/reduce/exit/reversal use canonical FIFO engine',()=>{
 for(const direction of ['LONG','SHORT']) {
  const data=fixture(),side=direction==='LONG'?'BUY':'SELL',opposite=side==='BUY'?'SELL':'BUY';
  let entry=draft(data,{side});assert.equal(previewEntry(data,entry,now).action,'ENTRY');
  data.fills=[fill('first',side,10,100)];
  entry=draft(data,{side,quantity:'5',price:'130'});let p=previewEntry(data,entry,now);assert.equal(p.action,'ADD');assert.equal(p.after.quantity,15);assert.equal(p.after.averageCost,110);
  data.fills.push(fill('second',side,5,130,'2026-08-28T16:00:00Z'));
  p=previewEntry(data,draft(data,{side:opposite,quantity:'12'}),now);assert.equal(p.action,'REDUCE');assert.equal(p.after.quantity,3);assert.equal(p.after.averageCost,130);
  p=previewEntry(data,draft(data,{side:opposite,quantity:'15'}),now);assert.equal(p.action,'EXIT');assert.equal(p.after,null);assert.equal(p.cycleId,'cycle-first');
  p=previewEntry(data,draft(data,{side:opposite,quantity:'20'}),now);assert.equal(p.action,'REVERSAL');assert.equal(p.after.quantity,5);assert.equal(p.cycleId,'cycle-new-open');
 }
});
test('reversal evidence records old exit and new entry without rewriting old annotation',()=>{
 const data=fixture();data.fills=[fill('first','SELL',10,100)];data.cycleReviews={'cycle-first':{entryQualityTag:'IDEAL'}};data.positionPlans={'cycle-first':{stopLoss:105}};
 const next=submit(data,draft(data,{side:'BUY',quantity:'15',fee:'3'}));
 assert.equal(next.entryContexts.new.cycleId,'cycle-new-open');assert.equal(contextsForCycle(next.entryContexts,'cycle-first').length,1);
 assert.deepEqual(next.entryContexts.new.strategyStages.map(stage=>[stage.cycleId,stage.phase]),[['cycle-first','EXIT'],['cycle-new-open','ENTRY']]);
 assert.deepEqual(next.cycleReviews,data.cycleReviews);assert.equal(next.entryContexts.new.planSnapshot.stopLoss,null,'new cycle must not inherit closed cycle plan');
 const result=buildCycles(next);assert.equal(result.cycles[0].fills.at(-1).fee,2);assert.equal(result.positions[0].fills[0].fee,1);
});
test('confirmation invalidates on quantity, timestamp, or inventory changes; no mutation on failure',()=>{
 const data=fixture(),entry=draft(data),original=JSON.stringify(data);entry.confirmedKey=previewEntry(data,entry,now).confirmationKey;
 assert.throws(()=>commitEntry(data,{...entry,quantity:'11'},snapshot(),now),/重新確認/);
 data.fills=[fill('a','BUY',3,100)];assert.throws(()=>commitEntry(data,entry,snapshot(),now),/重新確認/);data.fills=[];assert.equal(JSON.stringify(data),original);
});
test('historical insertion remaps annotated cycles without blocking and preserves original evidence',()=>{
 const data=fixture();data.fills=[fill('first','BUY',10,100)];data.cycleReviews={'cycle-first':{reflection:'keep'}};
 const early=draft(data,{timestamp:'2026-08-26T15:00:00Z'});assert.equal(previewEntry(data,early,now).affected[0].cycleId,'cycle-first');const rebuilt=submit(data,early);assert.equal(rebuilt.cycleReviews['cycle-new'].reflection,'keep');assert.equal(rebuilt.cycleRebuildHistory[0].original.cycleReviews['cycle-first'].reflection,'keep');assert.equal(data.cycleReviews['cycle-first'].reflection,'keep');
 assert.equal(previewEntry(data,draft(data),now).affected.length,0);
 for(const field of ['strategyAssignments','positionPlans','entryContexts']){const copy=fixture();copy.fills=data.fills;copy[field]=field==='entryContexts'?{old:{cycleId:'cycle-first'}}:{'cycle-first':{id:'preserve'}};assert.equal(previewEntry(copy,early,now).affected.length,1);}
});
test('same-time fill order is explicit; input errors differ from optional missing fields',()=>{
 const data=fixture();data.fills=[fill('first','BUY',5,100,'2026-08-28T17:00:00.000Z')];
 const p=previewEntry(data,draft(data),now);assert.equal(p.action,'ADD');assert.equal(p.sameTime,true);
 for(const patch of [{quantity:'NaN'},{price:'Infinity'},{fee:'-1'},{stopLoss:'0'},{market:'TWSE'},{timestamp:'2026-08-29T00:00:00Z'},{entrySetup:'FAKE'},{volumeTags:['FAKE']}])assert.ok(previewEntry(data,draft(data,patch),now).errors.length,JSON.stringify(patch));
 const next=submit(data,draft(data));assert.ok(next.entryContexts.new.pending.includes('主策略'));assert.ok(next.entryContexts.new.pending.includes('停損'));assert.equal(next.fills.length,2);
});
test('10 complete days exclude fill day and later information; volume ratio needs 11 valid volumes',()=>{
 const bars=Array.from({length:13},(_,i)=>({symbol:'AAA',date:`2026-08-${String(i+14).padStart(2,'0')}`,open:100,high:105,low:95,close:102,volume:100+i*10}));
 const e=buildEntryEvidence(bars,'2026-08-25T18:00:00Z','NASDAQ','AAA');
 assert.equal(e.candles.length,10);assert.equal(e.candles[0].date,'2026-08-15');assert.equal(e.candles.at(-1).date,'2026-08-24');assert.equal(e.fillDayBar.date,'2026-08-25');assert.equal(e.priorAverageVolume10,145);assert.equal(e.volumeRatio,200/145);assert.equal(e.averageVolume10,155);
 assert.equal(buildEntryEvidence(bars.slice(1),'2026-08-25T18:00:00Z','NASDAQ','AAA').volumeRatio,null);
 bars[0].volume=null;assert.equal(buildEntryEvidence(bars,'2026-08-25T18:00:00Z','NASDAQ','AAA').volumeRatio,null);
 assert.equal(marketDate('2026-08-25T02:00:00Z','NASDAQ'),'2026-08-24');assert.equal(marketDate('2026-08-25T02:00:00Z','TWSE'),'2026-08-25');
 assert.equal(buildEntryEvidence([],'2026-08-25','NASDAQ','AAA').averageVolume10,null);
});
test('NAV risk can be negative while stop still exits above cost; tranche and whole position differ',()=>{
 const data=fixture();data.fills=[fill('first','BUY',10,90)];const entry=draft(data,{quantity:'10',price:'110',stopLoss:'110',takeProfit:'140'}),p=previewEntry(data,entry,now);
 const result=entryValuation(data,p,entry,snapshot());assert.equal(p.after.averageCost,100);assert.equal(result.navUsd,100400);assert.equal(result.stop.costPnlUsd,200);assert.equal(result.stop.assetChangeUsd,-200);assert.equal(result.stop.assetChangePct,-200/100400);assert.equal(result.target.assetChangeUsd,400);assert.equal(result.positionPct,2400/100400);assert.equal(result.addedPct,1200/100400);
 const saved=submit(data,entry);assert.deepEqual(saved.entryContexts.new.valuation,result);
});
test('short stops invert price effect and missing quote/FX/NAV stays unavailable',()=>{
 const data=fixture();data.fills=[fill('first','SELL',10,150)];const entry=draft(data,{side:'SELL',price:'150',stopLoss:'130',takeProfit:'100'}),p=previewEntry(data,entry,now),v=entryValuation(data,p,entry,snapshot());
 assert.equal(v.stop.costPnlUsd,400);assert.equal(v.stop.assetChangeUsd,-200);assert.equal(v.target.assetChangeUsd,400);
 assert.ok(entryValuation(data,p,entry,{capturedAt:now,quotes:{}}).reasons.length);
 const tw=fixture();const d=draft(tw,{accountId:'twd',market:'TWSE',symbol:'2330'}),snap=snapshot();snap.quotes['2330.TW']={price:120,currency:'TWD',updatedAt:now};
 assert.ok(entryValuation(tw,previewEntry(tw,d,now),d,snap).navUsd>0);delete snap.quotes['USDTWD=X'];assert.match(entryValuation(tw,previewEntry(tw,d,now),d,snap).reasons.join(),/匯率/);
 const empty=fixture();empty.cashActivities=[];const equal=draft(empty,{price:'120'});assert.equal(entryValuation(empty,previewEntry(empty,equal,now),equal,snapshot()).navUsd,null);
});
test('historical registration does not invent exposure or borrow later plan; evidence key prevents stale bars',()=>{
 const data=fixture();data.fills=[fill('first','BUY',10,100,'2026-08-01T15:00:00Z')];data.positionPlans={'cycle-first':{stopLoss:130,updatedAt:now}};
 const entry=draft(data,{timestamp:'2026-08-20T15:00:00Z',evidenceKey:'stale-other-symbol',evidenceBars:[{symbol:'AAA',date:'2026-08-19',open:1,high:2,low:1,close:2}]});
 const next=submit(data,entry);assert.equal(next.entryContexts.new.valuation.navUsd,null);assert.equal(next.entryContexts.new.planSnapshot.stopLoss,null);assert.equal(next.entryContexts.new.evidence.candles.length,0);assert.deepEqual(next.positionPlans,data.positionPlans);
});
test('add inherits immutable strategy and plan, preserves opening checks, and saves independent observations',()=>{
 const data=fixture();data.fills=[fill('first','BUY',10,100)];const old=publishStrategyVersion({id:'s',name:'S',versions:[]},[{id:'r',name:'break',group:'ENTRY_TRIGGER',criterion:'close above 100'}],'v1','2026-08-01T00:00:00Z').strategy;
 data.strategyAssignments={'cycle-first':{...createStrategyAssignment({id:'cycle-first',openAt:data.fills[0].timestamp},old,'OPEN_POSITION','2026-08-27T16:00:00Z'),preChecks:{r:{status:'CONFIRMED',checkedAt:'2026-08-27T16:00:00Z'}}}};
 data.strategies=[publishStrategyVersion(old,[{id:'r2',group:'ENTRY_TRIGGER',criterion:'new'}],'v2').strategy];
 data.planHistory=[{id:'p1',cycleId:'cycle-first',field:'stopLoss',value:90,effectiveAt:'2026-08-27T16:00:00Z',createdAt:'2026-08-27T16:00:00Z'}];data.positionPlans={'cycle-first':{stopLoss:90,updatedAt:'2026-08-27T16:00:00Z'}};
 const entry=draft(data,{ruleChecks:{r:'NOT_MET'},addReason:'LOSS_ADD'});const next=submit(data,entry);
 assert.deepEqual(next.strategyAssignments,data.strategyAssignments);assert.equal(next.entryContexts.new.strategyVersionId,'s-v1');assert.equal(next.entryContexts.new.ruleChecks.r.status,'NOT_MET');assert.equal(next.entryContexts.new.ruleChecks.r.checkedAt,now);assert.equal(next.entryContexts.new.planReferences.stopLoss,'p1');assert.deepEqual(next.planHistory,data.planHistory);assert.deepEqual(next.positionPlans,data.positionPlans);
 const modified=submit(data,{...entry,stopLoss:'95'});assert.equal(modified.planHistory.length,2);assert.deepEqual(modified.planHistory[0],data.planHistory[0]);assert.equal(modified.planHistory[1].createdAt,now);assert.equal(modified.planHistory[1].effectiveAt,now);
});
test('new entry strategy is explicitly post-trade, does not activate a draft, and enforces fixed version',()=>{
 const data=fixture();data.strategies=[publishStrategyVersion({id:'s',name:'S',versions:[]},[{id:'r',group:'MARKET_CONDITION',name:'rule'}],'initial').strategy];
 const entry=draft(data,{strategyId:'s',strategyVersionId:'s-v1',ruleChecks:{r:'CONFIRMED'}});const next=submit(data,entry),a=next.strategyAssignments['cycle-new'];
 assert.equal(a.source,'POST_TRADE_ENTRY');assert.equal(a.assignedAt,now);assert.equal(a.lateAssignment,true);assert.equal(a.preChecks.r.checkedAt,now);
 assert.throws(()=>submit(data,{...entry,strategyVersionId:'bad'}),/策略版本/);data.strategies[0].status='DRAFT';assert.throws(()=>submit(data,entry),/停用/);
});
test('full closure hides entry fields, while replay and analysis retain per-fill evidence without double counting',()=>{
 let data=fixture();data=submit(data,draft(data,{id:'a',entrySetup:'BREAKOUT',volumeTags:['RANGE_BREAKOUT']}));
 data=submit(data,draft(data,{id:'b',quantity:'2',timestamp:'2026-08-28T17:10:00Z',entrySetup:'PULLBACK',addReason:'RETEST'}));
 data=submit(data,draft(data,{id:'c',side:'SELL',quantity:'12',timestamp:'2026-08-28T17:20:00Z'}));
 const cycles=buildCycles(data).cycles;assert.equal(cycles.length,1);assert.equal(data.entryContexts.c.entrySetup,null);assert.equal(filterCyclesByEntry(cycles,data.entryContexts,'BREAKOUT','RANGE_BREAKOUT','yes').length,1);
 assert.equal(contextsForCycle(data.entryContexts,cycles[0].id).length,3);
 const replay=buildCycleReplay(cycles[0],[],[],{},[],{},[],{},data.entryContexts);const events=replay.events.filter((event)=>event.type==='ENTRY_CONTEXT');assert.equal(events.length,3);assert.equal(events[0].timestamp,now);assert.ok(events[0].detail.includes('成交'));
 assert.equal(filterCyclesByEntry(cycles,{},'', '', 'no').length,0,'missing records do not imply no adds');
});
test('draft and committed fields survive auto/manual full JSON writes, store restart, and conflict rejection',async t=>{
 const {store}=await cloudStore(t),data=fixture();
 data.entryDraft=draft(data,{entrySetup:'BREAKOUT',volumeTags:['RANGE_BREAKOUT'],stopLoss:'95',takeProfit:'150'});data.entryDraft.evidenceKey=entryEvidenceKey(data.entryDraft);
 const payload=(dataset,version,mode)=>({accountId:'test',accountName:'test',dataset,baseVersion:version,saveMode:mode});
 await store.save(payload(data,null,'auto'));const resumed=(await store.read('test')).dataset;assert.deepEqual(resumed.entryDraft,data.entryDraft);assert.equal(resumed.fills.length,0);assert.equal(buildCycles(resumed).positions.length,0);
 const next=submit(resumed,resumed.entryDraft);assert.equal(next.entryDraft,undefined);await store.save(payload(next,1,'manual'));
 const recovered=(await store.read('test')).dataset;assert.deepEqual(recovered,JSON.parse(completeTradeJson(next)));assert.equal(recovered.entryContexts.new.planSnapshot.stopLoss,95);assert.equal(recovered.planHistory.length,2);
 await assert.rejects(store.save(payload(data,1,'auto')),e=>e.status===409);assert.deepEqual((await store.read('test')).dataset,recovered);
});


test('backdated closing fill splits prior cycle, preserves annotation audit and rebuilds realized trades',()=>{
 const data=fixture();data.fills=[fill('a','BUY',10,100,'2026-08-20T15:00:00Z'),fill('b','BUY',10,110,'2026-08-24T15:00:00Z'),fill('c','SELL',10,120,'2026-08-27T15:00:00Z')];
 data.cycleReviews={'cycle-a':{reflection:'original combined review'}};
 data.entryContexts={a:{fillId:'a',cycleId:'cycle-a',planSnapshot:{stopLoss:90}},b:{fillId:'b',cycleId:'cycle-a',planSnapshot:{stopLoss:95}}};
 const prior=JSON.stringify(data);
 const next=submit(data,draft(data,{side:'SELL',timestamp:'2026-08-22T15:00:00Z'}));
 const result=buildCycles(next);assert.equal(result.cycles.length,2);assert.equal(result.positions.length,0);
 assert.equal(result.cycles.reduce((sum,c)=>sum+c.pnl,0),200);
 assert.equal(next.cycleReviews['cycle-a'],undefined);assert.equal(next.cycleRebuildHistory[0].changes[0].automatic,false);
 assert.equal(next.cycleRebuildHistory[0].original.cycleReviews['cycle-a'].reflection,'original combined review');
 assert.equal(next.entryContexts.b.cycleId,'cycle-b');assert.deepEqual(next.entryContexts.b.planSnapshot,{stopLoss:95});assert.equal(JSON.stringify(data),prior);
 assert.deepEqual(JSON.parse(completeTradeJson(next)).cycleRebuildHistory,next.cycleRebuildHistory);
});

test('historical completed round trip automatically appears in closed cycles',()=>{
 let data=fixture();data.fills=[fill('later','BUY',5,125,'2026-08-27T15:00:00Z')];
 data=submit(data,draft(data,{id:'old-buy',timestamp:'2026-08-20T15:00:00Z',price:'100'}));
 data=submit(data,draft(data,{id:'old-sell',side:'SELL',timestamp:'2026-08-21T15:00:00Z',price:'120'}));
 const result=buildCycles(data);assert.equal(result.cycles.length,1);assert.equal(result.cycles[0].pnl,200);assert.equal(result.positions[0].id,'cycle-later');assert.equal(data.fills.length,3);
});
