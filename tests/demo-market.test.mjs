import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoRuntime,createDemoDataset,DEMO_CYCLE_COUNT,DEMO_CAPITAL} from '../lib/demo-workspace.mjs';
import {TEST_NOW,fixtureOptions,fixtureNetwork} from './market-fixture.mjs';
import {summarize,validateDataset} from '../lib/trade-engine.mjs';
import {marketDate} from '../lib/trade-entry.mjs';
import {simpleTimestamp} from '../lib/simple-entry.mjs';
import {normalizeYahooChart} from '../lib/quote-engine.mjs';

test('seed fills use actual sessions, raw closes and 10% budgets; positions are derived',()=>{
 const data=createDemoDataset(fixtureOptions()),report=summarize(data);
 assert.deepEqual(validateDataset(data),[]);assert.equal(data.fills.length,332);assert.equal(report.cycles.length,DEMO_CYCLE_COUNT);assert.equal(report.positions.length,2);assert.ok(report.cycles.some(c=>c.direction==='SHORT'));
 for(const fill of data.fills){const bar=data.marketBars.find(b=>b.symbol===fill.symbol&&b.date===fill.tradeDate);assert.equal(fill.price,bar.close);assert.equal(marketDate(fill.timestamp,fill.market),fill.tradeDate);assert.equal(fill.fee,0);assert.equal(fill.feeKnown,false);assert.match(fill.note,/示範成交/);}
 assert.equal(data.cashActivities.length,1);assert.equal(data.cashActivities[0].amount,50000);assert.deepEqual(data.strategies,[]);assert.deepEqual(data.strategyAssignments,{});
 assert.equal(data.marketSnapshot.quotes.AAPL.source,'Yahoo Finance via MarketDataAdapter');
 assert.equal(data.marketSnapshot.benchmarkBars[0].close,fixtureOptions().series.SPY.bars[0].close);
});
test('150 completed cycles span the past year without overlapping FIFO positions or exceeding entry budgets',()=>{
 const options=fixtureOptions(),data=createDemoDataset(options),report=summarize(data);
 assert.deepEqual(data.demoWarnings,[]);assert.deepEqual(createDemoDataset(options),data);
 assert.ok(new Set(report.cycles.map(c=>c.fills.at(-1).tradeDate.slice(0,7))).size>=12);
 assert.ok(Date.parse(data.fills.at(-1).tradeDate)-Date.parse(data.fills[0].tradeDate)>330*86400000);
 for(const symbol of ['AAPL','MSFT','2330']){
  const cycles=report.cycles.filter(c=>c.symbol===symbol).sort((a,b)=>a.openAt.localeCompare(b.openAt));
  assert.equal(cycles.length,50);
  for(let index=0;index<cycles.length;index++){
   const cycle=cycles[index],entry=cycle.fills[0];
   if(index)assert.ok(cycles[index-1].closeAt<cycle.openAt);
   const fx=symbol==='2330'?options.series['USDTWD=X'].bars.filter(b=>b.date<=entry.tradeDate).at(-1).close:1;
   const cost=entry.quantity*entry.price/fx;
   assert.ok(cost<=DEMO_CAPITAL*.1&&cost>DEMO_CAPITAL*.1-entry.price/fx);
   assert.ok(cycle.fills.every(f=>Number.isInteger(f.quantity)&&f.quantity>0));
  }
 }
 assert.equal(report.cycles.filter(c=>c.fills.length===3).length,30);
 for(const fill of data.fills)assert.ok(fill.tradeDate>='2025-10-07'&&fill.tradeDate<TEST_NOW.slice(0,10));
 for(const position of report.positions)assert.ok(position.openAt>report.cycles.filter(c=>c.symbol===position.symbol).at(-1).closeAt);
});
test('insufficient history and missing historical FX omit scenarios, never fabricate',()=>{
 const options=fixtureOptions();delete options.series['USDTWD=X'];options.series.AAPL.bars=[];
 const data=createDemoDataset(options);assert.ok(data.demoWarnings.length);assert.ok(!data.fills.some(f=>['AAPL','2330'].includes(f.symbol)));
 const empty=createDemoDataset();assert.equal(empty.fills.length,0);assert.equal(empty.marketBars.length,0);assert.deepEqual(empty.marketSnapshot.quotes,{});
});
test('sparse or out-of-year sessions never create artificial dates to reach 150 cycles',()=>{
 const options=fixtureOptions();delete options.series.MSFT;delete options.series['2330'];
 const source=options.series.AAPL.bars.slice(0,5);
 options.series.AAPL.bars=[{...source[0],date:'2024-01-02'},...source,{...source[0],date:'2026-10-07'},{...source[0],date:'2027-01-04'}];
 const data=createDemoDataset(options),report=summarize(data);
 assert.equal(report.cycles.length,1);assert.equal(report.positions.length,1);
 assert.match(data.demoWarnings.join('；'),/1／150/);
 assert.deepEqual(validateDataset(data),[]);
 for(const fill of data.fills)assert.ok(source.some(b=>b.date===fill.tradeDate&&b.close===fill.price));
});
test('guest forwards only anonymous market GET requests, strips credentials and chunks history',async()=>{
 const calls=[],runtime=createDemoRuntime({networkFetch:fixtureNetwork(calls),clock:()=>Date.parse(TEST_NOW)});await runtime.initialize();calls.length=0;
 const response=await runtime.fetcher('/api/quotes?symbols=MSFT,2330.TW',{headers:{Cookie:'secret','x-workspace-session':'member'},credentials:'include'});assert.equal(response.status,200);assert.equal((await response.json()).quotes.length,2);
 assert.equal(calls[0].init.credentials,'omit');assert.deepEqual(calls[0].init.headers,{Accept:'application/json'});
 for(const path of ['/api/trade-records','/api/ledgers','/api/admin/accounts','/api/auth/google-link','https://evil.test/api/quotes?symbols=AAPL'])assert.equal((await runtime.fetcher(path,{method:'PUT'})).status,403);
 assert.equal((await runtime.fetcher('https://evil.test/api/quotes?symbols=AAPL')).status,403);
 const before=calls.length;const history=await runtime.fetcher('/api/history?symbol=AAPL&start=2025-01-01&end=2099-12-01&mode=ohlc');assert.equal(history.status,200);assert.ok(calls.length>before+1);
 for(const call of calls.slice(before)){const p=new URL(call.input,'https://demo.invalid').searchParams;assert.ok((Date.parse(p.get('end'))-Date.parse(p.get('start')))/86400000<400);assert.ok(p.get('end')<=TEST_NOW.slice(0,10));}
});
test('clock advances, midnight changes default trading day, DST timestamps remain market-correct',async()=>{
 let time=Date.parse(TEST_NOW);const runtime=createDemoRuntime({clock:()=>time,networkFetch:fixtureNetwork([],()=>time)});await runtime.initialize();const original=runtime.read();
 time+=2*86400000;assert.equal(runtime.now(),'2026-10-09T12:00:00.000Z');assert.deepEqual(runtime.read(),original);
 for(const date of ['2026-03-06','2026-03-09','2026-11-02'])assert.equal(marketDate(simpleTimestamp(date,'NASDAQ','2026-12-01T12:00:00Z').timestamp,'NASDAQ'),date);
 assert.equal(simpleTimestamp('2026-03-06','NASDAQ','2026-12-01T12:00:00Z').timestamp,'2026-03-06T21:00:00.000Z');assert.equal(simpleTimestamp('2026-03-09','NASDAQ','2026-12-01T12:00:00Z').timestamp,'2026-03-09T20:00:00.000Z');
 assert.equal(marketDate('2026-10-07T00:00:00Z','NASDAQ'),'2026-10-06');assert.equal(marketDate('2026-10-07T00:00:00Z','TWSE'),'2026-10-07');
});
test('429 respects Retry-After, cancellation/reset cannot publish stale initialization',async()=>{
 let time=Date.parse(TEST_NOW),calls=0;
 const runtime=createDemoRuntime({clock:()=>time,networkFetch:async()=>{calls++;return Response.json({error:'limited'},{status:429,headers:{'Retry-After':'60'}});}});
 assert.equal((await runtime.fetcher('/api/quotes?symbols=AAPL')).status,429);await runtime.fetcher('/api/quotes?symbols=AAPL');assert.equal(calls,1);time+=60001;await runtime.fetcher('/api/quotes?symbols=AAPL');assert.equal(calls,2);
 const controller=new AbortController();controller.abort();await assert.rejects(runtime.fetcher('/api/quotes?symbols=AAPL',{signal:controller.signal}),{name:'AbortError'});
 let release;const gate=new Promise(resolve=>{release=resolve;});const delayed=createDemoRuntime({clock:()=>Date.parse(TEST_NOW),networkFetch:async(...args)=>{await gate;return fixtureNetwork()(...args);}});
 const init=delayed.initialize();delayed.reset();release();await assert.rejects(init,{name:'AbortError'});assert.equal(delayed.read().fills.length,0);
});
test('missing quote time is unknown and invalid prices are rejected',()=>{
 const payload=price=>({chart:{result:[{meta:{regularMarketPrice:price,currency:'USD'}}]}});
 assert.equal(normalizeYahooChart('AAPL',payload(100)).updatedAt,null);
 for(const price of [null,0,-1,'100',NaN])assert.throws(()=>normalizeYahooChart('AAPL',payload(price)));
});


test('US closing fills replay on the source exchange session, not the next Taipei day',async()=>{
 const {buildCycleReplay}=await import('../lib/coach-engine.mjs');
 const {buildPositionLedger}=await import('../lib/position-ledger.mjs');
 const data=createDemoDataset(fixtureOptions()),report=summarize(data);
 for(const cycle of report.cycles){const model=buildCycleReplay(cycle,data.marketBars);for(const event of model.events.filter(e=>e.source==='FILL')){const fill=cycle.fills.find(f=>event.id===`fill:${f.id}`);assert.equal(event.date,fill.tradeDate);assert.ok(model.candles.some(b=>b.date===event.date));}assert.equal(model.openDate,cycle.fills[0].tradeDate);assert.equal(model.closeDate,cycle.fills.at(-1).tradeDate);}
 for(const position of report.positions)for(const row of buildPositionLedger(position).rows)assert.equal(row.date,position.fills.find(f=>f.id===row.id).tradeDate);
});
