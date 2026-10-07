import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoRuntime as runtimeFactory,createDemoDataset as datasetFactory} from '../lib/demo-workspace.mjs';
import {TEST_NOW,fixtureNetwork,fixtureOptions} from './market-fixture.mjs';
const createDemoDataset=()=>datasetFactory(fixtureOptions());
const createDemoRuntime=async()=>{const runtime=runtimeFactory({clock:()=>Date.parse(TEST_NOW),networkFetch:fixtureNetwork()});await runtime.initialize();return runtime;};
import {validateCashActivity,updateCashActivity,cashDelta,CASH_TYPES,validCashAmount} from '../lib/cash-activities.mjs';
import {summarize} from '../lib/trade-engine.mjs';
import {buildCurrentEquity} from '../lib/portfolio-engine.mjs';
import {performanceRequests,loadPerformanceHistory} from '../lib/performance-history.mjs';
import {buildPerformanceDaily,performanceRange} from '../lib/performance-engine.mjs';

test('demo runtimes are independent, use captured real markets and never forward private APIs',async()=>{
 const a=await createDemoRuntime(),b=await createDemoRuntime(),original=b.read();
 const modified=a.read();modified.fills[0].price=999;a.update(modified);a.storage.setItem('journal','private-to-guest-a');
 assert.equal(b.storage.getItem('journal'),null);assert.deepEqual(b.read(),original);assert.deepEqual((await createDemoRuntime()).read(),original);
 const result=summarize(original);assert.equal(result.positions.length,2);assert.equal(result.cycles.length,150);assert.ok(result.cycles.some(c=>c.pnl<0));assert.ok(result.cycles.some(c=>c.pnl>0));
 for(const path of ['/api/ledgers','/api/admin/accounts','/api/auth/google-link'])assert.equal((await a.fetcher(path)).status,403);
 assert.equal((await a.fetcher('/api/trade-records',{method:'PUT'})).status,403);
 const unknown=await a.fetcher('/api/quotes?symbols=SECRET');const payload=await unknown.json();assert.deepEqual(payload.quotes,[]);assert.equal(payload.errors.length,1);
 const history=await b.fetcher('/api/history?symbol=2330.TW&start=2026-09-01&end=2099-12-01');assert.ok((await history.json()).bars.every(bar=>bar.date<=TEST_NOW.slice(0,10)));
});
test('real captured raw and adjusted histories support performance without private inputs',async()=>{
 const runtime=await createDemoRuntime(),data=runtime.read(),targets=performanceRequests(data,new Date(TEST_NOW));
 const history=await loadPerformanceHistory(targets,null,runtime.fetcher,new AbortController().signal,()=>{});
 assert.equal(history.errors.length,0,JSON.stringify(history.errors));
 const daily=buildPerformanceDaily(data,history.cache,new Date(TEST_NOW));const range=performanceRange(daily,daily.start,daily.end);
 assert.ok(range.points.length>200);assert.ok(range.points.some(point=>Number.isFinite(point.portfolio)));
});
test('cash input validates signs, local time conversion, zero corrections and preserves original fills',()=>{
 const data=createDemoDataset(),fills=structuredClone(data.fills),base={accountId:'demo-us',currency:'USD',timestamp:'2026-09-25T16:00:00+08:00',amount:'12.5',note:' hi '};
 for(const type of Object.keys(CASH_TYPES)){const row=validateCashActivity({...base,type},data.accounts);assert.equal(row.timestamp,'2026-09-25T08:00:00.000Z');assert.equal(row.note,'hi');assert.equal(cashDelta(row),['WITHDRAWAL','FEE','TAX'].includes(type)?-12.5:12.5);}
 for(const patch of [{amount:''},{amount:'NaN'},{amount:'-1'},{amount:'0'},{currency:'EUR'},{accountId:'other'},{timestamp:'bad'}])assert.throws(()=>validateCashActivity({...base,type:'DEPOSIT',...patch},data.accounts));
 assert.equal(validateCashActivity({...base,type:'OPENING_BALANCE',amount:0},data.accounts).amount,0);
 const row=validateCashActivity({...base,type:'DEPOSIT',id:'new'},data.accounts);const added=updateCashActivity(data,row),edited=updateCashActivity(added,{...row,amount:20});assert.equal(edited.cashActivities.length,data.cashActivities.length+1);assert.equal(edited.cashActivities.at(-1).amount,20);assert.deepEqual(edited.fills,fills);
 const quotes=data.marketSnapshot.quotes,fx=quotes['USDTWD=X'].price;
 const before=buildCurrentEquity(data,quotes,fx,new Date(TEST_NOW));const after=buildCurrentEquity(edited,quotes,fx,new Date(TEST_NOW));assert.ok(Math.abs(after.totalUsd-before.totalUsd-20)<1e-8);assert.deepEqual(summarize(edited).cycles,summarize(data).cycles);
});

test('cross-currency cash edit, delete and undo preserve FIFO while equity follows signed cash',()=>{
 const data=createDemoDataset(),quotes=data.marketSnapshot.quotes,fx=quotes['USDTWD=X'].price;
 const equity=d=>buildCurrentEquity(d,quotes,fx,new Date(TEST_NOW)).totalUsd;
 const base=equity(data);
 for(const type of ['DEPOSIT','WITHDRAWAL','DIVIDEND','INTEREST','FEE','TAX']){
  const row=validateCashActivity({id:'tw-cash',type,accountId:'demo-tw',currency:'TWD',amount:3200,timestamp:'2026-09-23T16:00:00+08:00'},data.accounts);
  const added=updateCashActivity(data,row),edited=updateCashActivity(added,{...row,amount:6400});
  assert.ok(Math.abs(equity(edited)-base-cashDelta({...row,amount:6400})/fx)<1e-7);
  const deleted={...edited,cashActivities:edited.cashActivities.filter(a=>a.id!==row.id)};assert.equal(equity(deleted),base);
  const undo=updateCashActivity(deleted,{...row,amount:6400});assert.deepEqual(undo,edited);assert.deepEqual(summarize(edited).cycles,summarize(data).cycles);
 }
});


test('cash preview never reverses an invalid outgoing amount',()=>{
 for(const type of ['DEPOSIT','WITHDRAWAL','DIVIDEND','INTEREST','FEE','TAX']){
  for(const amount of ['',null,undefined,0,-100,'NaN','Infinity'])assert.equal(validCashAmount(amount,type),false);
  assert.equal(validCashAmount('0.01',type),true);
 }
 assert.equal(validCashAmount(-100,'OPENING_BALANCE'),true);assert.equal(validCashAmount(0,'OPENING_BALANCE'),true);
});
