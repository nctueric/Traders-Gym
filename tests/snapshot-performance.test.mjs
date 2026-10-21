import test from 'node:test';
import assert from 'node:assert/strict';
import {performanceCacheFromSnapshot,buildDashboardSummary} from '../lib/snapshot-performance.mjs';

const now=new Date('2026-10-10T08:00:00Z');
const dataset={profile:{name:'x'},accounts:[{id:'a'}],settings:{benchmarkSymbol:'QQQ'},fills:[{id:'b',accountId:'a',symbol:'AAA',market:'NASDAQ',currency:'USD',side:'BUY',quantity:1,price:10,fee:0,timestamp:'2026-01-02T00:00:00Z'}],cashActivities:[{id:'c',type:'OPENING_BALANCE',currency:'USD',amount:100,timestamp:'2026-01-01T00:00:00Z'}],marketBars:[{symbol:'AAA',date:'2025-12-31',close:9},{symbol:'AAA',date:'2026-10-09',close:12},{symbol:'USDTWD=X',date:'2026-10-09',close:32}],marketSnapshot:{version:1,quotes:{AAA:{price:12},'USDTWD=X':{price:32}},benchmarkSymbol:'QQQ',benchmarkBars:[{symbol:'QQQ',date:'2026-10-09',close:600}]}};

test('snapshot seeds raw, FX and benchmark performance evidence',()=>{
 const cache=performanceCacheFromSnapshot(dataset);
 assert.equal(cache.entries['AAA:raw'].bars.length,2);
 assert.equal(cache.entries['USDTWD=X:raw'].bars[0].close,32);
 assert.equal(cache.entries['QQQ:adjusted'].bars[0].close,600);
});

test('saved dashboard summary contains both currencies and all overview periods',()=>{
 const summary=buildDashboardSummary(dataset,performanceCacheFromSnapshot(dataset),now);
 assert.deepEqual(Object.keys(summary.currencies),['USD','TWD']);
 for(const value of Object.values(summary.currencies))for(const period of ['month','ytd','week'])assert.ok(value[period]&&Object.hasOwn(value[period],'rate'));
 assert.deepEqual(summary.currencies.USD.months.map(row=>row.month),['2026-08','2026-09','2026-10']);
});
