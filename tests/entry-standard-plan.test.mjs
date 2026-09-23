import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalEntryStandard,resolveEntryPlan} from '../lib/entry-standard-plan.mjs';
import {entryChartCandles,liveDailyMetadata} from '../lib/entry-market.mjs';
import {createEntryDraft,previewEntry,commitEntry} from '../lib/trade-entry.mjs';
const pair=(id,accountId,price,day)=>[{id:id+'a',accountId,symbol:id,currency:'USD',market:'NASDAQ',side:'BUY',quantity:1,price:100,fee:0,timestamp:`2026-01-${day}T01:00:00Z`},{id:id+'b',accountId,symbol:id,currency:'USD',market:'NASDAQ',side:'SELL',quantity:1,price,fee:0,timestamp:`2026-01-${day}T02:00:00Z`}];
const data={accounts:[{id:'a',currency:'USD'}],fills:[...pair('win','a',120,'01'),...pair('win2','b',140,'02'),...pair('loss','b',80,'03'),...pair('flat','a',100,'04'),...pair('future','a',900,'10')],marketBars:[]};
const at='2026-01-05T12:00:00Z',std=historicalEntryStandard(data,at);
const preview={action:'ENTRY',after:{averageCost:100,direction:'LONG'},plan:{}};
test('standards use all accounts, closed wins/losses only and exclude future trades',()=>{
 assert.equal(std.winnerCount,2);assert.equal(std.loserCount,1);assert.ok(Math.abs(std.averageWinRate-.3)<1e-12);assert.ok(Math.abs(std.averageLossRate+.2)<1e-12);
 const open={...data,fills:[...data.fills,{...data.fills[0],id:'unclosed',symbol:'open',price:1}]};assert.deepEqual(historicalEntryStandard(open,at),std);
});
test('long and short targets use mean win and half mean loss around post-trade cost',()=>{
 const long=resolveEntryPlan({},preview,std),short=resolveEntryPlan({}, {...preview,after:{averageCost:100,direction:'SHORT'}},std);
 assert.equal(+long.takeProfit,130);assert.equal(+long.stopLoss,90);assert.equal(+short.takeProfit,70);assert.equal(+short.stopLoss,110);
 assert.equal(long.stopBasis,'HISTORICAL_STANDARD');assert.equal(long.standardSnapshot.averageCost,100);
});
test('auto recalculates until manual edit; applying standard restores auto source',()=>{
 let d=resolveEntryPlan({},preview,std);d=resolveEntryPlan(d,{...preview,after:{averageCost:200,direction:'LONG'}},std);assert.equal(+d.takeProfit,260);
 d={...d,stopLoss:'87.12345',planModes:{...d.planModes,stopLoss:'MANUAL'}};const next=resolveEntryPlan(d,preview,std);assert.equal(next.stopLoss,'87.12345');
 assert.equal(+resolveEntryPlan({...next,planModes:{stopLoss:'STANDARD',takeProfit:'STANDARD'}},preview,std).stopLoss,90);
});
test('adds/reductions inherit plans, reversals start fresh and exits save no plan',()=>{
 for(const action of ['ADD','REDUCE']){const d=resolveEntryPlan({}, {...preview,action,plan:{stopLoss:70,takeProfit:160}},std);assert.equal(d.stopLoss,70);assert.equal(d.takeProfit,160);assert.equal(d.stopBasis,'ORIGINAL');}
 assert.equal(+resolveEntryPlan({}, {...preview,action:'REVERSAL',plan:{}},std).stopLoss,90);
 assert.equal(resolveEntryPlan({}, {...preview,action:'EXIT',after:null},std).stopLoss,'');
});
test('missing samples and nonpositive computed prices are blank, not fabricated or clamped',()=>{
 const missing=resolveEntryPlan({},preview,historicalEntryStandard({fills:[]},at));assert.equal(missing.takeProfit,'');assert.equal(missing.stopLoss,'');
 assert.equal(resolveEntryPlan({}, {...preview,after:{averageCost:100,direction:'SHORT'}},{...std,averageWinRate:1.2}).takeProfit,'');
 assert.equal(resolveEntryPlan({},preview,{...std,averageLossRate:-2.5}).stopLoss,'');
});
test('v2 commit snapshots standards atomically, omits removed pending labels and preserves source ledger',()=>{
 const draft={...createEntryDraft(data.accounts,at,'new'),symbol:'NEW',quantity:'2',price:'100',timestamp:at};const before=structuredClone(data);draft.confirmedKey=previewEntry(data,draft,at).confirmationKey;
 const out=commitEntry(data,draft,{quotes:{},capturedAt:at},at);const context=out.entryContexts.new;
 assert.equal(context.formatVersion,2);assert.equal(context.planSnapshot.takeProfit,130);assert.equal(context.planSnapshot.stopLoss,90);assert.equal(context.standardSnapshot.sources.stopLoss,'STANDARD');assert.equal(context.standardSnapshot.winnerCount,2);
 assert.ok(!context.pending.some(p=>['進場型態','量價觀察','加碼理由','停損依據'].includes(p)));assert.deepEqual(data,before);assert.equal(out.fills.length,data.fills.length+1);
});
test('chart deduplicates current bars, rejects invalid OHLC, warms EMA before display and keeps missing volume',()=>{
 const bars=Array.from({length:100},(_,i)=>({symbol:'A',date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:100,high:110,low:90,close:100,volume:1000}));
 const last={...bars.at(-1),close:105,volume:null};const result=entryChartCandles([...bars,last,{...last,date:'2026-04-11',high:0}],'A','2026-03-01','2026-04-11');
 assert.equal(result[0].ema[50],100);assert.equal(result.at(-1).close,105);assert.equal(result.at(-1).volume,null);assert.equal(result.at(-1).volumeRatio,null);assert.equal(result.length,new Set(result.map(b=>b.date)).size);
});
test('live metadata uses exchange day and explicit session end, not UTC date or fetch time',()=>{
 const time=Date.parse('2026-09-24T00:30:00Z')/1000,end=time+100;
 const payload={chart:{result:[{meta:{exchangeTimezoneName:'America/New_York',regularMarketTime:time,currentTradingPeriod:{regular:{end}}}}]}};
 const m=liveDailyMetadata(payload,time*1000);assert.equal(m.tradingDate,'2026-09-23');assert.equal(m.sessionComplete,false);assert.equal(liveDailyMetadata(payload,end*1000).sessionComplete,true);
 const missing=liveDailyMetadata({});assert.equal(missing.quoteTime,null);assert.equal(missing.sessionComplete,null);
});
test('prior-session bar is complete before next regular session opens',()=>{
 const quote=Date.parse('2026-09-22T20:00:00Z')/1000,start=Date.parse('2026-09-23T13:30:00Z')/1000;
 const meta={regularMarketTime:quote,exchangeTimezoneName:'America/New_York',currentTradingPeriod:{regular:{start,end:start+23400}}};
 assert.equal(liveDailyMetadata({chart:{result:[{meta}]}},Date.parse('2026-09-23T10:00:00Z')).sessionComplete,true);
});
