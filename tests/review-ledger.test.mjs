import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCycles } from '../lib/trade-engine.mjs';
import { historicalEquityAt, lastInvestmentDate, buildReviewLedgerMetrics, reviewHistoryRequests } from '../lib/review-ledger.mjs';
const fill=(id,date,side,quantity,price,extra={})=>({id,accountId:'a',symbol:'ABC',currency:'USD',side,quantity,price,fee:0,timestamp:date+'T12:00:00Z',...extra});
const cash=(id,date,amount,extra={})=>({id,accountId:'a',currency:'USD',type:'DEPOSIT',amount,timestamp:date+'T00:00:00Z',...extra});
const bar=(date,close,extra={})=>({symbol:'ABC',date,open:close,high:close,low:close,close,...extra});
const base=()=>({accounts:[{id:'a'}],fills:[fill('buy','2026-01-02','BUY',10,10),fill('partial','2026-01-03','SELL',5,12),fill('add','2026-01-04','BUY',5,11),fill('exit','2026-01-05','SELL',10,13)],cashActivities:[cash('deposit','2026-01-01',1000)],marketBars:[bar('2026-01-02',10),bar('2026-01-04',12),bar('2026-01-05',13)]});
test('cumulative investment includes adds without netting partial exits, using final add day',()=>{
 const data=base(), cycle=buildCycles(data).cycles[0];const before=JSON.stringify(data);
 assert.equal(cycle.entryNotional,155);assert.equal(lastInvestmentDate(cycle),'2026-01-04');
 const result=buildReviewLedgerMetrics(data,[cycle],[cycle]).rows[cycle.id];
 assert.equal(result.equity.total,1025);assert.equal(result.allocation,155/1025);assert.equal(result.pnl,35);assert.equal(result.expectancy,null);assert.equal(JSON.stringify(data),before);
});
test('end-of-day includes withdrawals, fees and all accounts; no future fills, prices or flows',()=>{
 const data=base();data.accounts.push({id:'b'});data.cashActivities.push(cash('b','2026-01-01',200,{accountId:'b'}),cash('withdraw','2026-01-04',20,{type:'WITHDRAWAL'}),cash('fee','2026-01-04',2,{type:'FEE'}),cash('future','2026-01-06',99999));data.fills[2].fee=1;data.marketBars.push(bar('2026-02-01',10000));
 assert.equal(historicalEquityAt(data,'2026-01-04').total,1202);
});
test('each account opening replaces only its own cash; previous holdings remain',()=>{
 const data=base();data.cashActivities.push(cash('reset','2026-01-04',900,{type:'OPENING_BALANCE'}),cash('b','2026-01-01',300,{accountId:'b'}));
 // Reset cash 900, same-day add -55, 10 held shares at 12; other account 300.
 assert.equal(historicalEquityAt(data,'2026-01-04').total,1265);
 data.cashActivities.push(cash('reset-again','2026-01-05',700,{type:'OPENING_BALANCE'}));
 assert.equal(historicalEquityAt(data,'2026-01-05').total,1130);
 assert.equal(historicalEquityAt(data,'2025-12-31').total,null);
});
test('opening timestamps govern cash within the day',()=>{
 const data=base();data.cashActivities=[cash('reset','2026-01-04',900,{type:'OPENING_BALANCE',timestamp:'2026-01-04T13:00:00Z'})];
 assert.equal(historicalEquityAt(data,'2026-01-04').total,1020);
 assert.equal(historicalEquityAt(data,'2026-01-03').total,null);
});
test('short market liabilities and reversal split investments are accounted for',()=>{
 const data={accounts:[{id:'a'}],cashActivities:[cash('d','2026-01-01',100)],fills:[fill('short','2026-01-02','SELL',10,20),fill('reverse','2026-01-03','BUY',15,15),fill('exit','2026-01-04','SELL',5,16)],marketBars:[bar('2026-01-02',25),bar('2026-01-03',15)]};
 assert.equal(historicalEquityAt(data,'2026-01-02').total,50);
 const cycles=buildCycles(data).cycles;assert.equal(cycles[0].entryNotional,200);assert.equal(cycles[1].entryNotional,75);assert.equal(lastInvestmentDate(cycles[1]),'2026-01-03');
 const m=buildReviewLedgerMetrics(data,cycles,cycles);assert.equal(m.rows[cycles[0].id].allocation,4);assert.equal(m.rows[cycles[1].id].allocation,0.5);
});
test('cross-currency equity uses historical FX and exposes actual dates',()=>{
 const data=base();data.cashActivities.push(cash('tw','2026-01-01',3200,{currency:'TWD',accountId:'b'}));data.marketBars.push(bar('2026-01-03',32,{symbol:'USDTWD=X'}),bar('2026-02-01',40,{symbol:'USDTWD=X'}));
 const e=historicalEquityAt(data,'2026-01-04');assert.equal(e.total,1125);assert.deepEqual(e.fx,{date:'2026-01-03',rate:32});assert.equal(historicalEquityAt(data,'2026-01-04','TWD').total,36000);
 data.marketBars=data.marketBars.filter(b=>b.symbol!=='USDTWD=X'||b.date>'2026-01-04');assert.equal(historicalEquityAt(data,'2026-01-04').total,null);
});
test('single-currency TWD does not need a USD rate',()=>{
 const data={accounts:[{id:'a'}],cashActivities:[cash('tw','2026-01-01',3200,{currency:'TWD'})],fills:[],marketBars:[]};assert.equal(historicalEquityAt(data,'2026-01-02','TWD').total,3200);
});
test('missing funding, pending cash, unsupported currency or nonpositive equity remain gaps',()=>{
 const d=base();d.cashActivities=[];assert.equal(historicalEquityAt(d,'2026-01-04').total,null);
 for(const patch of [{requiresReview:true},{currency:null},{currency:'EUR'}]){d.cashActivities=[cash('bad','2026-01-01',1000,patch)];assert.equal(historicalEquityAt(d,'2026-01-04').total,null);}
 d.cashActivities=[cash('negative','2026-01-01',-1000)];assert.equal(historicalEquityAt(d,'2026-01-04').total,null);
});
test('missing prices do not fall back to cost; prior close is dated, no lookahead',()=>{
 const d=base();d.marketBars=[bar('2026-01-05',99)];assert.equal(historicalEquityAt(d,'2026-01-04').total,null);
 d.marketBars.push(bar('2026-01-02',10));const e=historicalEquityAt(d,'2026-01-04');assert.equal(e.total,1005);assert.equal(e.prices[0].date,'2026-01-02');assert.ok(e.warnings.length);
});
test('ambiguous cash ownership and duplicate opening snapshots are gaps',()=>{
 const d=base();d.accounts.push({id:'b'});d.cashActivities[0].accountId=null;assert.equal(historicalEquityAt(d,'2026-01-04').total,null);
 d.cashActivities=[cash('a','2026-01-01',1000,{type:'OPENING_BALANCE'}),cash('b','2026-01-01',1000,{type:'OPENING_BALANCE'})];assert.equal(historicalEquityAt(d,'2026-01-04').total,null);
});
test('expectancy uses arithmetic mean of all filtered losses independent of visible N',()=>{
 const cycles=[{id:'win',pnl:20,entryNotional:100,currency:'USD',fills:[]},{id:'loss1',pnl:-10,entryNotional:100,currency:'USD',fills:[]},{id:'loss2',pnl:-60,entryNotional:200,currency:'USD',fills:[]}];
 const all=buildReviewLedgerMetrics(base(),cycles,cycles),limited=buildReviewLedgerMetrics(base(),cycles.slice(0,1),cycles);
 assert.equal(all.averageLoss,0.2);assert.equal(limited.rows.win.expectancy,1);assert.equal(all.rows.loss2.expectancy,-1.4999999999999998);
 assert.equal(buildReviewLedgerMetrics(base(),cycles.slice(0,1),cycles.slice(0,2)).rows.win.expectancy,2);
 assert.equal(buildReviewLedgerMetrics(base(),cycles,[]).rows.win.expectancy,null);
});
test('history requests include other held symbols and FX, not only reviewed symbol',()=>{
 const d=base();d.fills.push(fill('other','2026-01-01','BUY',1,20,{symbol:'2330',market:'TWSE',currency:'TWD',accountId:'b'}));
 const req=reviewHistoryRequests(d,buildCycles(d).cycles);assert.deepEqual(req.map(r=>r.symbol),['2330.TW','ABC','USDTWD=X']);assert.ok(req.every(r=>r.end==='2026-01-04'));
});
test('same symbol on distinct markets must not share prices',()=>{
 const d={accounts:[{id:'a'}],fills:[fill('a','2026-01-02','BUY',1,10,{symbol:'1234',market:'TWSE',currency:'TWD'}),fill('b','2026-01-02','BUY',1,10,{symbol:'1234',market:'TPEX',currency:'TWD'})],cashActivities:[cash('d','2026-01-01',100,{currency:'TWD'})],marketBars:[bar('2026-01-02',20,{symbol:'1234'})]};
 assert.equal(historicalEquityAt(d,'2026-01-02','TWD').total,null);
 const bars=[bar('2026-01-02',20,{symbol:'1234.TW'}),bar('2026-01-02',30,{symbol:'1234.TWO'})];assert.equal(historicalEquityAt(d,'2026-01-02','TWD',bars).total,130);
});
test('a later deposit cannot imply an unknown earlier opening balance',()=>{
 const d=base();d.cashActivities=[cash('late','2026-01-03',1000)];assert.equal(historicalEquityAt(d,'2026-01-04').total,null);
});

test('shared dollar pool funds Taiwan trades from USD cash without a second opening balance',async()=>{
 const {sharedDollarEquityAt}=await import('../lib/review-ledger.mjs');
 const data={accounts:[{id:'a'},{id:'tw'}],cashActivities:[cash('fund','2026-01-01',1000)],fills:[fill('tw-buy','2026-01-02','BUY',10,320,{accountId:'tw',symbol:'2330',market:'TWSE',currency:'TWD',fee:32}),fill('tw-add','2026-01-03','BUY',5,640,{accountId:'tw',symbol:'2330',market:'TWSE',currency:'TWD'}),fill('tw-exit','2026-01-04','SELL',15,600,{accountId:'tw',symbol:'2330',market:'TWSE',currency:'TWD'})],marketBars:[bar('2026-01-02',32,{symbol:'USDTWD=X'}),bar('2026-01-03',40,{symbol:'USDTWD=X'}),bar('2026-01-03',600,{symbol:'2330.TW'}),bar('2026-01-05',10,{symbol:'USDTWD=X'})]};
 const before=JSON.stringify(data),e=sharedDollarEquityAt(data,'2026-01-03');
 assert.equal(e.cashUsd,819);assert.equal(e.positionsUsd,225);assert.equal(e.total,1044);assert.deepEqual(e.problems,[]);
 const cycles=buildCycles(data).cycles,m=buildReviewLedgerMetrics(data,cycles,cycles).rows[cycles[0].id];assert.equal(m.investedUsd,180);assert.equal(m.allocation,180/1044);assert.equal(m.equity.currency,'USD');assert.equal(JSON.stringify(data),before);
 data.marketBars=data.marketBars.filter(b=>b.symbol!=='USDTWD=X'||b.date>'2026-01-03');assert.equal(sharedDollarEquityAt(data,'2026-01-03').total,null);
});
test('shared pool preserves prior Taiwan cash flows after exit and values short liabilities in USD',async()=>{
 const {sharedDollarEquityAt}=await import('../lib/review-ledger.mjs');const d={accounts:[{id:'a'},{id:'tw'}],cashActivities:[cash('fund','2026-01-01',1000)],fills:[fill('tw','2026-01-02','SELL',10,320,{accountId:'tw',symbol:'2330',currency:'TWD'}),fill('cover','2026-01-03','BUY',10,400,{accountId:'tw',symbol:'2330',currency:'TWD'})],marketBars:[bar('2026-01-02',32,{symbol:'USDTWD=X'}),bar('2026-01-03',40,{symbol:'USDTWD=X'}),bar('2026-01-02',384,{symbol:'2330'})]};
 assert.equal(sharedDollarEquityAt(d,'2026-01-02').total,980);assert.equal(sharedDollarEquityAt(d,'2026-01-04').total,1000);
 assert.deepEqual(reviewHistoryRequests(d,[{direction:'LONG',fills:[fill('later','2026-02-10','BUY',1,1)]}]).find(r=>r.symbol==='USDTWD=X').start,'2025-11-23');
});
