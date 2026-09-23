import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYtdReturn } from '../lib/ytd-return.mjs';
const now = new Date('2026-07-01T00:00:00Z');
const base = { fills:[], marketBars:[], cashActivities:[{type:'DEPOSIT',timestamp:'2025-01-01T00:00:00Z',currency:'USD',amount:1000}] };
test('YTD without external flows is profit divided by opening equity',()=>{
 const r=buildYtdReturn(base,{totalUsd:1100},32,now);assert.equal(r.profitUsd,100);assert.equal(r.rate,.1);assert.deepEqual(r.problems,[]);
});
test('deposits are not profit and their timing changes invested capital',()=>{
 const time=new Date((Date.parse('2026-01-01T00:00:00Z')+now.getTime())/2).toISOString();
 const data={...base,cashActivities:[...base.cashActivities,{type:'DEPOSIT',timestamp:time,currency:'USD',amount:1000}]};
 const r=buildYtdReturn(data,{totalUsd:2150},32,now);assert.equal(r.profitUsd,150);assert.equal(r.rate,.1);
 assert.equal(buildYtdReturn(data,{totalUsd:2000},32,now).rate,0);
});
test('withdrawals are excluded, dividends remain profit, future flows ignored',()=>{
 const data={...base,cashActivities:[...base.cashActivities,{type:'WITHDRAWAL',timestamp:'2026-01-01T00:00:00Z',currency:'USD',amount:200},{type:'DIVIDEND',timestamp:'2026-02-01T00:00:00Z',currency:'USD',amount:80},{type:'DEPOSIT',timestamp:'2027-01-01T00:00:00Z',currency:'USD',amount:9000}]};
 assert.equal(buildYtdReturn(data,{totalUsd:880},32,now).rate,.1);
});
test('missing baseline and cash resets do not fabricate YTD',()=>{
 assert.equal(buildYtdReturn({...base,cashActivities:[]},{totalUsd:1100},32,now).rate,null);
 const data={...base,cashActivities:[...base.cashActivities,{type:'OPENING_BALANCE',timestamp:'2026-02-01T00:00:00Z',currency:'USD',amount:1200}]};
 assert.equal(buildYtdReturn(data,{totalUsd:1300},32,now).rate,null);
 assert.equal(buildYtdReturn(base,{totalUsd:null},32,now).rate,null);
});
test('TWD flows use disclosed constant FX and preserve source',()=>{
 const data={...base,cashActivities:[...base.cashActivities,{type:'DEPOSIT',timestamp:'2026-01-01T00:00:00Z',currency:'TWD',amount:32000}]};
 const before=JSON.stringify(data);assert.equal(buildYtdReturn(data,{totalUsd:2200},32,now).rate,.1);assert.equal(JSON.stringify(data),before);
 assert.equal(buildYtdReturn(data,{totalUsd:2200},null,now).rate,null);
});

test('monthly return uses previous month end and excludes earlier deposits', async()=>{
 const {buildMonthReturn,monthlyReturnSignal}=await import('../lib/ytd-return.mjs');
 const data={...base,cashActivities:[...base.cashActivities,{type:'DEPOSIT',timestamp:'2026-03-01T00:00:00Z',currency:'USD',amount:1000}]};
 const result=buildMonthReturn(data,{totalUsd:1840},32,new Date('2026-07-16T00:00:00Z'));
 assert.equal(result.baselineUsd,2000);assert.equal(result.profitUsd,-160);assert.equal(result.rate,-.08);
 for(const [rate,tone] of [[.30,'normal'],[.30001,'exceptional'],[.5,'exceptional'],[0,'normal'],[-.04999,'normal'],[-.05,'warning'],[-.07999,'warning'],[-.08,'danger'],[-.09999,'danger'],[-.10,'critical'],[-.2,'critical'],[null,'unknown'],[NaN,'unknown']])assert.equal(monthlyReturnSignal(rate).tone,tone);
 const january=buildMonthReturn(base,{totalUsd:1100},32,new Date('2026-01-16T00:00:00Z'));assert.equal(january.rate,.1);
});

test('weekly return starts Monday and includes only this week cash flows',async()=>{
 const {buildWeekReturn}=await import('../lib/ytd-return.mjs');
 const data={...base,cashActivities:[...base.cashActivities,{type:'DEPOSIT',timestamp:'2026-09-20T12:00:00Z',currency:'USD',amount:1000},{type:'DEPOSIT',timestamp:'2026-09-21T00:00:00Z',currency:'USD',amount:500}]};
 const r=buildWeekReturn(data,{totalUsd:2750},32,new Date('2026-09-23T12:00:00Z'));
 assert.equal(r.baselineUsd,2000);assert.equal(r.profitUsd,250);assert.equal(r.rate,.1);
 const jan=buildWeekReturn(base,{totalUsd:1100},32,new Date('2026-01-01T12:00:00Z'));assert.equal(jan.rate,.1);
 const bars={...base,fills:[{id:'buy',accountId:'main',symbol:'AAA',currency:'USD',side:'BUY',quantity:1,price:100,fee:0,timestamp:'2025-06-01T00:00:00Z'}],marketBars:[{symbol:'AAA',date:'2026-09-18',close:100},{symbol:'AAA',date:'2026-09-22',close:900}]};
 assert.equal(buildWeekReturn(bars,{totalUsd:1100},32,new Date('2026-09-23T12:00:00Z')).baselineUsd,1000);
});
