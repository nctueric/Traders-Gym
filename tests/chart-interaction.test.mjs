import test from 'node:test';
import assert from 'node:assert/strict';
import {withEma,emaWarmupStart,inspectChartPoint} from '../lib/chart-indicators.mjs';
import {buildCycleReplay,replayWindowDates} from '../lib/coach-engine.mjs';

test('EMA seeds with SMA, recurs correctly, and never uses later closes',()=>{
 const bars=Array.from({length:100},(_,i)=>({close:i+1}));const result=withEma(bars);
 for(const n of [10,21,50]){assert.equal(result[n-2].ema[n],null);assert.equal(result[n-1].ema[n],(n+1)/2);const expected=(n+1)*2/(n+1)+(n+1)/2*(1-2/(n+1));assert.ok(Math.abs(result[n].ema[n]-expected)<1e-10);}
 assert.deepEqual(withEma(bars.slice(0,60)),result.slice(0,60));
 assert.deepEqual(withEma([...bars.slice(0,60),{close:999999}]).slice(0,60),result.slice(0,60));
});
test('chart hit testing distinguishes price and volume, clamps final candle and excludes margins',()=>{
 const g={left:16,right:216,top:24,priceBottom:224,volumeBottom:324,low:10,high:110,step:20};
 assert.equal(inspectChartPoint(g,10,16,24).index,0);
 assert.equal(inspectChartPoint(g,10,216,224).index,9);
 assert.equal(inspectChartPoint(g,10,100,124).price,60);
 assert.equal(inspectChartPoint(g,10,100,250).price,null);
 assert.equal(inspectChartPoint(g,10,15,100),null);
 assert.equal(inspectChartPoint(g,10,40,325),null);
});
test('EMA warms up before display range and does not consume visible candle cap',()=>{
 assert.equal(emaWarmupStart('2024-02-29'),'2023-02-28');
 const cycle={id:'ema',symbol:'AAA',openAt:'2026-08-03T12:00:00Z',closeAt:'2026-08-06T12:00:00Z',fills:[],averageEntry:100,direction:'LONG',quantity:1,pnl:0};
 const window=replayWindowDates(cycle);const first=new Date(emaWarmupStart(window.start)+'T00:00:00Z');
 const bars=Array.from({length:550},(_,i)=>({symbol:'AAA',date:new Date(+first+i*86400000).toISOString().slice(0,10),open:100,high:100,low:100,close:100,volume:1}));
 const model=buildCycleReplay(cycle,bars);assert.equal(model.candles[0].date,window.start);assert.equal(model.candles[0].ema[50],100);assert.ok(model.candles.length>150);assert.ok(model.candles.every(c=>c.date<=window.end));
 const subset=bars.filter(b=>b.date>=window.start);assert.equal(buildCycleReplay(cycle,subset).candles[0].ema[50],null);
});

import {missingHistoryRanges} from '../lib/history-coverage.mjs';
import {buildTradeSnapshot,reconcileTradeSnapshots} from '../lib/trade-snapshot.mjs';
test('saved history coverage fetches only gaps, new dates or explicit refresh',()=>{
 const target={symbol:'AAA',market:'NASDAQ',start:'2026-01-01',end:'2026-09-18'};
 const now=Date.parse('2026-09-18T12:00:00Z');
 const saved=[{...target,start:'2026-02-01',end:'2026-09-17',fetchedAt:'2026-09-17T12:00:00Z'}];
 assert.deepEqual(missingHistoryRanges(target,saved,now),[{start:'2026-01-01',end:'2026-01-31'},{start:'2026-09-18',end:'2026-09-18'}]);
 const full=[{...target,fetchedAt:'2026-09-18T11:59:00Z'}];
 assert.deepEqual(missingHistoryRanges(target,full,now),[]);
 assert.deepEqual(missingHistoryRanges(target,full,now+3600000),[{start:'2026-09-18',end:'2026-09-18'}]);
 assert.deepEqual(missingHistoryRanges(target,full,now,true),[{start:target.start,end:target.end}]);
 const data={fills:[],marketBars:[{symbol:'AAA',date:'2026-09-17',close:12}],marketSnapshot:{ohlcCoverage:full}};
 const snapshot=buildTradeSnapshot(data,{quotes:{},lastQuoteAt:null,benchmarkBars:[],benchmarkSymbol:'SPY'});
 assert.deepEqual(JSON.parse(JSON.stringify(snapshot)).marketSnapshot.ohlcCoverage,full);
 assert.deepEqual(reconcileTradeSnapshots(snapshot,snapshot,null).marketSnapshot.ohlcCoverage,full);
});
