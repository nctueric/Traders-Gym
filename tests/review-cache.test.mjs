import test from 'node:test';import assert from 'node:assert/strict';
import {reviewCacheKey,scopedReviewMetrics} from '../lib/review-cache.mjs';
import {reviewCacheHandler} from '../lib/review-cache-api.mjs';
import {holdingTradingDays} from '../lib/review-ledger.mjs';
test('derived cache ignores quotes and reviews but invalidates financial inputs',async()=>{
 const d={fills:[{id:'x',price:10}],cashActivities:[],marketBars:[],accounts:[]}, c=[{id:'c',pnl:10,entryNotional:100}];const k=await reviewCacheKey(d,c);
 assert.equal(await reviewCacheKey({...d,cycleReviews:{c:{entryQualityTag:'IDEAL'}},marketSnapshot:{quotes:[1]}},c),k);
 for(const changed of [{...d,fills:[{id:'x',price:11}]},{...d,cashActivities:[{amount:1}]},{...d,marketBars:[{close:1}]}])assert.notEqual(await reviewCacheKey(changed,c),k);
 const rows={c:{returnPct:.2}};assert.equal(scopedReviewMetrics(rows,[{pnl:-10,entryNotional:100}]).rows.c.expectancy,2);assert.equal(scopedReviewMetrics(rows,[]).rows.c.expectancy,null);
});
test('trading days use distinct observed sessions including both endpoints',()=>{
 const c={symbol:'ABC',openAt:'2026-01-02',closeAt:'2026-01-06'};const bars=['2026-01-02','2026-01-05','2026-01-06','2026-01-06'].map(date=>({symbol:'ABC',date,close:10}));
 assert.equal(holdingTradingDays(c,bars),3);assert.equal(holdingTradingDays(c,bars.slice(1)),null);assert.equal(holdingTradingDays({...c,closeAt:c.openAt},bars),1);
 assert.equal(holdingTradingDays({...c,openAt:'2026-01-03',closeAt:'2026-01-05'},bars),1); // Weekend entry date counts only observed sessions.
});
test('cloud derived cache enforces ownership, session, origin, and input key without modifying ledger',async()=>{
 const objects=new Map();let puts=0;const env={authenticate:async()=>({id:'owner',sessionId:'session'}),db:{prepare:()=>({bind:(account,user)=>({first:async()=>account==='ledger'&&user==='owner'?{account_id:account}:null})})},objects:{get:async k=>{const v=objects.get(k);return v?{body:v.body,customMetadata:v.meta}:null;},put:async(k,body,opts)=>{puts++;objects.set(k,{body,meta:opts.customMetadata});}}};
 const key='a'.repeat(64);const url='https://test/api/review-valuations?accountId=ledger&key='+key;const payload={version:1,key,savedAt:'2026-01-01T00:00:00Z',rows:{}};const req=(method,headers={})=>new Request(url,{method,headers:{Origin:'https://test','x-workspace-session':'session',...headers},...(method==='PUT'?{body:JSON.stringify(payload)}:{})});
 assert.equal((await reviewCacheHandler(req('PUT',{'x-workspace-session':'wrong'}),env)).status,401);
 assert.equal((await reviewCacheHandler(req('PUT',{Origin:'https://evil'}),env)).status,403);
 assert.equal((await reviewCacheHandler(new Request(url.replace('ledger','other')),env)).status,403);assert.equal(puts,0);
 assert.equal((await reviewCacheHandler(req('PUT'),env)).status,200);assert.equal(puts,1);
 assert.deepEqual(await(await reviewCacheHandler(req('GET'),env)).json(),payload);
 assert.deepEqual(await(await reviewCacheHandler(new Request(url.replace(key,'b'.repeat(64))),env)).json(),{cache:null});
 assert.ok([...objects.keys()][0].startsWith('review-valuations/'));
});
