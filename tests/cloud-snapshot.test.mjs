import test from 'node:test';
import assert from 'node:assert/strict';
import {compactCloudSnapshot} from '../lib/cloud-snapshot.mjs';

const fill=(id,side,date)=>({id,accountId:'a',symbol:'AAA',market:'NASDAQ',currency:'USD',side,quantity:1,price:10,fee:0,timestamp:`${date}T12:00:00Z`});
const bar=(symbol,date)=>({symbol,date,open:10,high:11,low:9,close:10,volume:1});

test('cloud snapshot keeps authored data and calculation bars while dropping refreshable replay context',()=>{
 const source={profile:{name:'x'},accounts:[{id:'a'}],settings:{},fills:[fill('buy','BUY','2026-01-10'),fill('sell','SELL','2026-01-20')],cashActivities:[{id:'cash'}],marketBars:[bar('AAA','2025-10-01'),bar('AAA','2026-01-10'),bar('AAA','2026-01-15'),bar('AAA','2026-01-20'),bar('AAA','2026-04-01'),bar('USDTWD=X','2025-01-01')],marketSnapshot:{version:1,quotes:{AAA:{price:10}},ohlcCoverage:[{symbol:'AAA'}]},cycleReviews:{review:{note:'keep'}}};
 const compact=compactCloudSnapshot(source);
 assert.deepEqual(compact.marketBars.map(row=>`${row.symbol}:${row.date}`),['AAA:2026-01-10','AAA:2026-01-15','AAA:2026-01-20','USDTWD=X:2025-01-01']);
 assert.deepEqual(compact.cycleReviews,source.cycleReviews);assert.deepEqual(compact.cashActivities,source.cashActivities);assert.deepEqual(compact.marketSnapshot.quotes,source.marketSnapshot.quotes);assert.deepEqual(compact.marketSnapshot.ohlcCoverage,[]);
 assert.equal(source.marketBars.length,6);assert.equal(source.marketSnapshot.ohlcCoverage.length,1);
});

test('open positions retain every later bar',()=>{
 const source={profile:{name:'x'},accounts:[],settings:{},fills:[fill('buy','BUY','2026-01-10')],marketBars:[bar('AAA','2026-01-09'),bar('AAA','2026-01-10'),bar('AAA','2026-10-10')]};
 assert.deepEqual(compactCloudSnapshot(source).marketBars.map(row=>row.date),['2026-01-10','2026-10-10']);
});
