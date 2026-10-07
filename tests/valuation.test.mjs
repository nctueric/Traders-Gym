import test from 'node:test';import assert from 'node:assert/strict';
import {buildPerformanceDaily,performanceRange} from '../lib/performance-engine.mjs';
import {convertCurrency,currencyTotal,historicalFx,cycleValue} from '../lib/valuation.mjs';
import {realizedValue} from '../lib/valuation-reports.mjs';
import {legacyBrowserRecords} from '../lib/legacy-records.mjs';
const dates=['2026-01-01','2026-01-02','2026-01-03'];
const series=values=>({bars:values.map((close,i)=>({date:dates[i],close}))});
const cache={entries:{'QQQ:adjusted':series([100,110,121]),'SPY:adjusted':series([100,100,100]),'USDTWD=X:raw':series([30,33,36]),'A:raw':series([10,10,10])}};
const cash=(currency,amount,type='OPENING_BALANCE',date=dates[0])=>({id:type+date,type,currency,amount,timestamp:date});
const end=new Date('2026-01-04');
const near=(actual,want)=>assert.ok(Math.abs(actual-want)<1e-10,`${actual} vs ${want}`);
test('USD cash and adjusted ETFs gain actual daily FX return in TWD; source ledger stays untouched',()=>{
 const ledger={cashActivities:[cash('USD',1000)],fills:[]},before=structuredClone(ledger);
 const usd=buildPerformanceDaily(ledger,cache,end,'USD'),twd=buildPerformanceDaily(ledger,cache,end,'TWD');
 assert.deepEqual(usd.points.map(p=>p.total),[1000,1000,1000]);assert.deepEqual(twd.points.map(p=>p.total),[30000,33000,36000]);
 const r=performanceRange(twd,twd.start,twd.end);near(r.summary.portfolio,.2);near(r.summary.SPY,.2);near(r.summary.QQQ,.452);assert.deepEqual(ledger,before);
});
test('pure TWD balances retain native valuation while USD performance includes FX losses and drawdown',()=>{
 const ledger={cashActivities:[cash('TWD',30000)],fills:[]};
 const twd=buildPerformanceDaily(ledger,cache,end,'TWD'),usd=buildPerformanceDaily(ledger,cache,end,'USD');assert.deepEqual(twd.points.map(p=>p.total),[30000,30000,30000]);near(usd.points[2].total,30000/36);
 const r=performanceRange(usd,usd.start,usd.end);near(r.summary.portfolio,-1/6);near(r.summary.maxDrawdown,-1/6);
 const missing={entries:{'QQQ:adjusted':series([100,100,100]),'SPY:adjusted':series([100,100,100])}};
 assert.equal(buildPerformanceDaily(ledger,missing,end,'TWD').points[2].total,30000);assert.equal(buildPerformanceDaily(ledger,missing,end,'USD').points[2].total,null);
});
test('mixed native cash, positions and deposits use historical FX without counting flows as profit',()=>{
 const ledger={cashActivities:[cash('USD',1000),cash('TWD',3000,'DEPOSIT',dates[1])],fills:[{id:'fill',symbol:'A',currency:'USD',accountId:'us',side:'BUY',quantity:10,price:10,fee:0,timestamp:dates[0]}]};
 const d=buildPerformanceDaily(ledger,cache,end,'TWD');assert.deepEqual(d.points.map(p=>p.total),[30000,36000,39000]);assert.equal(d.points[1].flow,3000);near(d.points[1].rate,3000/31500);assert.equal(d.points[0].cashValue,27000);assert.equal(d.points[0].positionsValue,3000);
});
test('realized cycles use market closing day FX; native return and R remain untouched',()=>{
 const bars=cache.entries['USDTWD=X:raw'].bars,cycle={currency:'USD',pnl:10,closeAt:'2026-01-02T01:00:00Z',returnPct:.1,rMultiple:2,fills:[{tradeDate:'2026-01-01'}]};
 assert.equal(cycleValue(cycle,cycle.pnl,'TWD',bars),300);assert.equal(realizedValue([cycle],'TWD',bars),300);assert.equal(cycle.returnPct,.1);assert.equal(cycle.rMultiple,2);
 assert.equal(realizedValue([cycle],'TWD',[]),null);assert.equal(cycleValue(cycle,10,'USD',[]),10);
 assert.equal(historicalFx(bars,'2026-01-11'),null);assert.equal(historicalFx([{date:'2026-01-05',close:36}],'2026-01-04'),null);
 assert.equal(convertCurrency(null,'USD','TWD',30),null);assert.equal(convertCurrency(1,'USD','TWD',0),null);assert.equal(currencyTotal({USD:1,TWD:30},'USD',null),null);
});
test('legacy browser discovery is owner scoped, read only, and never replaces cloud automatically',()=>{
 const dataset={profile:{name:'old'},accounts:[],fills:[],marketBars:[],settings:{}};
 const values=new Map([['trade-review.phase0.v1.user.a.primary.pending',JSON.stringify({serialized:JSON.stringify(dataset),baseVersion:7})],['trade-review.phase0.v1.user.ab.primary',JSON.stringify(dataset)],['trade-review.phase0.v1',JSON.stringify(dataset)]]);
 const storage={length:values.size,key:i=>[...values.keys()][i],getItem:k=>values.get(k),setItem(){throw Error('must not write');}};
 assert.equal(legacyBrowserRecords(storage,'a').length,1);assert.equal(legacyBrowserRecords(storage,'a')[0].version,7);assert.equal(legacyBrowserRecords(storage,'other').length,0);assert.equal(values.size,3);
});
