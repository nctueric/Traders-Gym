import test from 'node:test';import assert from 'node:assert/strict';
import {buildPerformanceDaily,performanceRange,dailyDietz} from '../lib/performance-engine.mjs';
import {normalizePerformanceHistory} from '../lib/quote-engine.mjs';
import {loadPerformanceHistory} from '../lib/performance-history.mjs';
const now=new Date('2026-01-05T12:00:00Z');
const series=(symbol,values,basis='raw')=>[symbol+':'+basis,{bars:values.map((close,i)=>({date:`2026-01-0${i+1}`,close}))}];
const cache=(extra=[])=>({entries:Object.fromEntries([series('QQQ',[100,110,99,108],'adjusted'),series('SPY',[100,102,104,103],'adjusted'),...extra])});
const cash=(type,amount,date='2026-01-01',currency='USD')=>({id:type+date,type,amount,currency,timestamp:date});
const data=(activities=[],fills=[])=>({cashActivities:[cash('DEPOSIT',1000),...activities],fills});
test('external cash does not become profit; dividends and costs remain return',()=>{
 const d=buildPerformanceDaily(data([cash('DEPOSIT',100,'2026-01-02'),cash('WITHDRAWAL',200,'2026-01-03'),cash('DIVIDEND',9,'2026-01-04')]),cache(),now);
 assert.equal(d.points[1].rate,0);assert.equal(d.points[2].rate,0);assert.equal(d.points[3].rate,.01);
 const r=performanceRange(d,d.start,d.end);assert.ok(Math.abs(r.summary.portfolio-.01)<1e-10);assert.ok(Math.abs(r.summary.QQQ-.08)<1e-10);
});
test('Dietz timing and invalid denominator',()=>{assert.equal(dailyDietz(100,220,[{amount:100,weight:1}]),.1);assert.equal(dailyDietz(100,220,[{amount:100,weight:.5}]),20/150);assert.equal(dailyDietz(100,200,[{amount:-200,weight:1}]),null);});
test('long/short, partial exits, fees, multiple accounts, historical FX and no future data',()=>{
 const fills=[{symbol:'2330',market:'TWSE',accountId:'tw',currency:'TWD',side:'BUY',quantity:10,price:32,fee:0,timestamp:'2026-01-01'},{symbol:'A',accountId:'us',currency:'USD',side:'SELL',quantity:2,price:10,fee:1,timestamp:'2026-01-01'},{symbol:'A',accountId:'us',currency:'USD',side:'BUY',quantity:1,price:8,fee:0,timestamp:'2026-01-02'}];
 const d=buildPerformanceDaily(data([],fills),cache([series('2330.TW',[32,32,32,32]),series('A',[10,8,8,8]),series('USDTWD=X',[32,16,16,16])]),now);
 assert.equal(d.points[0].total,999);assert.equal(d.points[1].total,1013);assert.equal(d.points.length,4);assert.equal(d.end,'2026-01-04');
});
test('missing data and opening resets break cumulative performance and drawdown',()=>{
 const d=buildPerformanceDaily(data([cash('OPENING_BALANCE',1200,'2026-01-03')]),cache(),now);const r=performanceRange(d,d.start,d.end);assert.equal(r.points[2].portfolio,null);assert.equal(r.summary.portfolio,null);assert.equal(r.summary.maxDrawdown,null);
 const gap=cache();gap.entries['QQQ:adjusted'].bars=[];assert.equal(performanceRange(buildPerformanceDaily(data(),gap,now),'2026-01-01','2026-01-04').summary.QQQ,null);
});
test('drawdown and monthly compounding use same return index',()=>{
 const fills=[{symbol:'A',currency:'USD',side:'BUY',quantity:10,price:100,fee:0,timestamp:'2026-01-01'}];const d=buildPerformanceDaily(data([],fills),cache([series('A',[100,120,90,110])]),now);const r=performanceRange(d,d.start,d.end);
 assert.ok(Math.abs(r.summary.portfolio-.1)<1e-10);assert.equal(r.summary.maxDrawdown,-.25);assert.ok(Math.abs(r.months[0].portfolio-.1)<1e-10);assert.equal(r.months[0].partial,true);
});
test('strict adjusted history never falls back or treats null as zero',()=>{
 const payload={chart:{result:[{timestamp:[1,2],indicators:{quote:[{close:[100,110]}]}}]}};
 assert.throws(()=>normalizePerformanceHistory('QQQ',payload,'adjusted'));assert.equal(normalizePerformanceHistory('QQQ',payload,'raw').length,2);
});
test('multi-year requests are chunked and cached separately by basis',async()=>{
 const targets=[{symbol:'QQQ',basis:'adjusted',start:'2023-01-01',end:'2025-01-01'}];let calls=0;
 const fetcher=async url=>{calls++;const q=new URL(url,'http://qa').searchParams;return {ok:true,json:async()=>({priceBasis:'adjusted',bars:[{date:q.get('start'),close:100},{date:q.get('end'),close:110}]})};};
 const a=await loadPerformanceHistory(targets,null,fetcher,new AbortController().signal);assert.equal(calls,3);await loadPerformanceHistory(targets,a.cache,fetcher,new AbortController().signal);assert.equal(calls,3);assert.ok(a.cache.entries['QQQ:adjusted']);assert.equal(a.cache.entries['QQQ:raw'],undefined);
});
test('selected partial month uses same end-of-day baseline as cumulative chart',()=>{
 const fills=[{symbol:'A',currency:'USD',side:'BUY',quantity:10,price:100,fee:0,timestamp:'2026-01-01'}];const d=buildPerformanceDaily(data([],fills),cache([series('A',[100,120,90,110])]),now);const r=performanceRange(d,'2026-01-02','2026-01-04');assert.equal(r.months[0].portfolio,r.summary.portfolio);assert.equal(r.months[0].QQQ,r.summary.QQQ);assert.equal(r.points[0].portfolio,0);
});
test('stale quotes, missing FX and unknown currency fail closed without fill-price fallback',()=>{
 const fills=[{symbol:'A',currency:'TWD',side:'BUY',quantity:10,price:32,fee:0,timestamp:'2026-01-01'}];
 const missing=buildPerformanceDaily(data([],fills),cache([series('A',[32,32,32,32])]),now);assert.equal(missing.points.at(-1).total,null);assert.match(missing.points.at(-1).problems.join(),/USDTWD/);
 const prices=cache([series('A',[32]),series('USDTWD=X',[32])]);prices.entries['QQQ:adjusted'].bars=[{date:'2026-01-20',close:100}];prices.entries['SPY:adjusted'].bars=[{date:'2026-01-20',close:100}];
 const stale=buildPerformanceDaily(data([],fills),prices,new Date('2026-01-21'));assert.equal(stale.points.at(-1).total,null);assert.match(stale.points.at(-1).problems.join(),/逾七日/);
 const unknown=buildPerformanceDaily(data([],[{...fills[0],currency:null}]),cache([series('A',[32,32,32,32])]),now);assert.equal(unknown.points[0].total,null);
});
test('zero returns stay valid and future fills never affect earlier valuation',()=>{
 const base=data();const copy=structuredClone(base);copy.fills.push({symbol:'A',currency:'USD',side:'BUY',quantity:10,price:100,fee:0,timestamp:'2026-02-01'});const a=buildPerformanceDaily(base,cache(),now),b=buildPerformanceDaily(copy,cache(),now);assert.deepEqual(a,b);assert.equal(performanceRange(a,a.start,a.end).summary.portfolio,0);
});
test('cash opening replaces cash while retaining existing holdings; unknown fee is disclosed',()=>{
 const fills=[{symbol:'A',currency:'USD',side:'BUY',quantity:1,price:100,fee:null,feeKnown:false,timestamp:'2026-01-01'}];const d=buildPerformanceDaily(data([cash('OPENING_BALANCE',100,'2026-01-03')],fills),cache([series('A',[100,100,100,100])]),now);assert.equal(d.points[2].total,200);assert.equal(d.points[2].rate,null);assert.ok(d.points[2].warnings.includes('未含未填手續費'));
});
test('failed or wrong-basis requests are retryable and never cached as successful coverage',async()=>{
 const targets=[{symbol:'QQQ',basis:'adjusted',start:'2026-01-01',end:'2026-01-04'}];const result=await loadPerformanceHistory(targets,null,async()=>({ok:true,json:async()=>({priceBasis:'raw',bars:[{date:'2026-01-01',close:100}]})}),new AbortController().signal);assert.equal(result.errors.length,1);assert.equal(result.cache.entries['QQQ:adjusted'].coverage.length,0);
});
test('timestamp offsets use UTC valuation day and remaining-day weights without mutating ledger',()=>{
 const source=data([cash('DEPOSIT',100,'2026-01-03T03:00:00+08:00'),cash('DIVIDEND',10,'2026-01-02T22:00:00Z')]);
 const before=structuredClone(source),d=buildPerformanceDaily(source,cache(),now);
 assert.equal(d.points[1].flow,100);assert.equal(d.points[2].flow,0);assert.equal(d.points[1].rate,10/(1000+100*5/24));assert.deepEqual(source,before);
});
test('invalid calendar dates are flagged instead of silently rolling into another month',()=>{
 const d=buildPerformanceDaily(data([cash('DIVIDEND',10,'2026-02-30')]),cache(),now);assert.equal(d.points[0].total,null);assert.match(d.problems.join(),/無效日期/);
});
test('incremental weekend coverage accepts prior actual quotes and does not retry holidays forever',async()=>{
 const targets=[{symbol:'QQQ',basis:'adjusted',start:'2026-01-03',end:'2026-01-04'}];let calls=0;
 const fetcher=async()=>{calls++;return {ok:true,json:async()=>({priceBasis:'adjusted',bars:[{date:'2026-01-02',close:100}]})};};
 const result=await loadPerformanceHistory(targets,null,fetcher,new AbortController().signal);assert.deepEqual(result.errors,[]);assert.equal(result.cache.entries['QQQ:adjusted'].bars[0].date,'2026-01-02');
 await loadPerformanceHistory(targets,result.cache,fetcher,new AbortController().signal);assert.equal(calls,1);
});
test('same-time opening capital is applied before executions, preserving trade cash deductions',()=>{
 const d=buildPerformanceDaily({cashActivities:[cash('OPENING_BALANCE',1000)],fills:[{symbol:'A',currency:'USD',side:'BUY',quantity:1,price:100,fee:1,timestamp:'2026-01-01'}]},cache([series('A',[100,100,100,100])]),now);
 assert.equal(d.points[0].total,999);assert.equal(d.points[0].cashUsd,899);
});

const holidayDates=Array.from({length:13},(_,i)=>new Date(Date.UTC(2026,1,11+i)).toISOString().slice(0,10));
function holidayFixture({last='2026-02-11',reopen=true,fxMissing=false,symbol='2330.TW'}={}) {
 const entries={};
 for(const s of ['QQQ','SPY'])entries[s+':adjusted']={bars:holidayDates.map(date=>({date,close:100}))};
 entries[symbol+':raw']={bars:[{date:last,close:320},...(reopen?[{date:'2026-02-23',close:352}]:[])]};
 entries['USDTWD=X:raw']={bars:fxMissing?[{date:'2026-02-11',close:32}]:holidayDates.map(date=>({date,close:date>='2026-02-19'?40:32}))};
 return {entries};
}
const holidayLedger={cashActivities:[cash('DEPOSIT',1000,'2026-02-11')],fills:[{symbol:'2330',market:'TWSE',currency:'TWD',side:'BUY',quantity:10,price:320,fee:0,timestamp:'2026-02-11'}]};
test('Taiwan spring closure preserves cumulative returns while historical FX and US assets keep changing',()=>{
 const ledger=structuredClone(holidayLedger),prices=holidayFixture();
 ledger.fills.push({symbol:'A',currency:'USD',side:'BUY',quantity:1,price:100,fee:0,timestamp:'2026-02-11'});
 const before=structuredClone(ledger);
 prices.entries['A:raw']={bars:holidayDates.map(date=>({date,close:date>='2026-02-19'?110:100}))};
 const d=buildPerformanceDaily(ledger,prices,new Date('2026-02-24'));
 const feb19=d.points.find(p=>p.date==='2026-02-19');assert.equal(feb19.total,990);assert.equal(feb19.quoteDates['2330.TW'],'2026-02-11');assert.match(feb19.warnings.join(),/休市/);
 assert.equal(d.points.at(-1).total,998);assert.equal(d.points.at(-1).quoteDates['2330.TW'],'2026-02-23');
 const r=performanceRange(d,d.start,d.end);assert.ok(r.points.every(p=>p.portfolio!=null));assert.ok(Math.abs(r.summary.portfolio+.002)<1e-12);assert.equal(r.months[0].portfolio,r.summary.portfolio);assert.ok(Math.abs(r.summary.maxDrawdown+.01)<1e-12);assert.deepEqual(ledger,before);
});
test('holiday exception never hides missing final session, reopening quote, FX or US prices',()=>{
 const run=prices=>buildPerformanceDaily(holidayLedger,prices,new Date('2026-02-24'));
 const noFinal=run(holidayFixture({last:'2026-02-10'}));assert.equal(noFinal.points.find(p=>p.date==='2026-02-19').total,null);
 const noReopen=run(holidayFixture({reopen:false}));assert.equal(noReopen.points.find(p=>p.date==='2026-02-22').total,980);assert.equal(noReopen.points.at(-1).total,null);assert.equal(performanceRange(noReopen,noReopen.start,noReopen.end).summary.portfolio,null);
 const noFx=run(holidayFixture({fxMissing:true}));assert.match(noFx.points.find(p=>p.date==='2026-02-19').problems.join(),/USDTWD/);
 const usLedger={...holidayLedger,fills:[{...holidayLedger.fills[0],symbol:'A',market:'NASDAQ',currency:'USD',price:32,quantity:1}]};
 const us=buildPerformanceDaily(usLedger,holidayFixture({symbol:'A',reopen:false}),new Date('2026-02-24'));assert.match(us.points.find(p=>p.date==='2026-02-19').problems.join(),/A 行情逾七日/);
});
test('closure lookback fetches the real last session during an extended holiday',async()=>{
 const target={symbol:'2330.TW',basis:'raw',start:'2026-02-20',end:'2026-02-22'};let start;
 const result=await loadPerformanceHistory([target],null,async url=>{start=new URL(url,'http://qa').searchParams.get('start');return {ok:true,json:async()=>({priceBasis:'raw',bars:[{date:'2026-02-11',close:320}]})};},new AbortController().signal);
 assert.equal(start,'2026-02-11');assert.deepEqual(result.errors,[]);assert.equal(result.cache.entries['2330.TW:raw'].bars[0].date,'2026-02-11');
});
