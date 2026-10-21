import test from 'node:test';
import assert from 'node:assert/strict';
import {marketRotation,normalizeRotationPayload,reconcileRotationBars,coherentPreview} from '../lib/rotation-market.mjs';
import {publicMarket} from '../lib/market-data.mjs';
import {mergeRotationSnapshot,shouldRefreshRotation} from '../lib/rotation-client.mjs';
import {rotationFixture,ROTATION_NOW} from './rotation-fixture.mjs';
function opts(transform=x=>x,now=ROTATION_NOW){return {now:()=>now,cache:new Map(),latestCache:new Map(),fetcher:async input=>{const symbol=decodeURIComponent(new URL(input).pathname.split('/').at(-1));return Response.json(transform(rotationFixture(symbol,now),symbol));}};}
const req=(query='symbols=XLK&benchmark=SPY')=>new Request('https://local.test/api/market/rotation?'+query);
test('API returns timestamped daily and weekly series, provisional points replace the current period',async()=>{
 const options=opts();const first=await (await marketRotation(req(),options)).json();assert.equal(first.rows.length,1);assert.equal(first.version,'tg-rotation-v1');assert.equal(first.rows[0].weekly.at(-1).complete,false);assert.equal(first.rows[0].daily.at(-1).complete,false);
 const second=await (await marketRotation(req('symbols=XLK&mode=latest'),options)).json();assert.equal(first.rows[0].weekly.length,second.rows[0].weekly.length);assert.equal(first.rows[0].daily.length,second.rows[0].daily.length);
});
test('unsafe inputs are rejected before upstream work and only GET is supported',async()=>{
 const options=opts(()=>{throw Error('must not fetch');});for(const query of ['symbols=AAPL','benchmark=BAD','interval=5m','mode=wrong','symbols=XLK&url=https://example.com'])assert.equal((await marketRotation(req(query),options)).status,400);
 assert.equal((await marketRotation(new Request('https://local.test',{method:'POST'}),options)).status,405);
});
test('missing current adjustment factor suppresses preview, never falls back to raw',async()=>{
 const body=await (await marketRotation(req(),opts((p,s)=>{if(s==='XLK')p.chart.result[0].indicators.adjclose[0].adjclose[p.chart.result[0].timestamp.length-1]=null;return p;}))).json();assert.equal(body.rows[0].preview,false);assert.equal(body.rows[0].daily.at(-1).date,'2026-10-20');assert.ok(body.warnings.length);
});
test('one symbol failure is partial; benchmark failure freezes the entire update',async()=>{
 const partial=await marketRotation(req('symbols=XLK,XLF'),opts((p,s)=>s==='XLF'?{}:p));const body=await partial.json();assert.equal(body.rows.length,1);assert.equal(body.errors[0].symbol,'XLF');assert.equal(partial.headers.get('Cache-Control'),'no-store');
 const failed=await marketRotation(req(),opts((p,s)=>s==='SPY'?{}:p));assert.equal(failed.status,502);
});
test('out-of-sync quote times cannot create a live comparison; stale sessions cannot rank',async()=>{
 const data=await (await marketRotation(req(),opts((p,s)=>{if(s==='XLK')p.chart.result[0].meta.regularMarketTime-=600;return p;}))).json();assert.equal(data.rows[0].preview,false);
 const stale=await (await marketRotation(req(),opts((p,s)=>{if(s==='XLK')p.chart.result[0].meta.regularMarketTime-=86400*3;return p;}))).json();assert.equal(stale.rows.length,0);assert.ok(stale.errors.length);
 const a=normalizeRotationPayload(rotationFixture(),ROTATION_NOW);assert.equal(coherentPreview({...a,quoteTime:ROTATION_NOW+60000},a,ROTATION_NOW),false);
});
test('historical adjustment changes rescale older bars without fake jumps; inconsistent factors reject',()=>{
 const history=[1,2,3,4].map(i=>({date:`2026-10-0${i}`,close:100,raw:100}));const recent=[{date:'2026-10-03',close:50,raw:50},{date:'2026-10-04',close:51,raw:51},{date:'2026-10-05',close:52,raw:52}];assert.throws(()=>reconcileRotationBars(history,recent),/重新載入/);
 recent[1].close=50;const merged=reconcileRotationBars(history,recent);assert.equal(merged[0].close,50);assert.equal(merged.at(-1).close,52);
});
test('regular-session close converts provisional points to completed points',async()=>{
 const now=Date.parse('2026-10-23T20:02Z');const body=await (await marketRotation(req(),opts(x=>x,now))).json();assert.equal(body.rows[0].weekly.at(-1).date,'2026-10-23');assert.equal(body.rows[0].weekly.at(-1).complete,true);assert.equal(body.marketOpen,false);
});
test('rate limiting and error propagation use the existing public service',async()=>{
 const response=await publicMarket(req(),marketRotation,{limiter:{limit:async()=>({success:false})}});assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');
 const failed=await marketRotation(req(),{...opts(),fetcher:async()=>{throw new DOMException('slow','TimeoutError');}});assert.equal(failed.status,502);
});
test('polling is disabled for hidden pages, history replay and closed market',()=>{
 assert.equal(shouldRefreshRotation({visible:true,latest:true,now:ROTATION_NOW}),true);assert.equal(shouldRefreshRotation({visible:false,latest:true,now:ROTATION_NOW}),false);assert.equal(shouldRefreshRotation({visible:true,latest:false,now:ROTATION_NOW}),false);assert.equal(shouldRefreshRotation({visible:true,latest:true,now:Date.parse('2026-10-24T17:00Z')}),false);
});
test('failed symbols retain history marked stale, and recovery removes stale state',()=>{
 const previous={benchmark:'SPY',rows:[{symbol:'XLK',daily:[1]}]};const partial=mergeRotationSnapshot(previous,{benchmark:'SPY',rows:[],errors:[{symbol:'XLK'}]});assert.equal(partial.rows[0].stale,true);const recovery=mergeRotationSnapshot(partial,{benchmark:'SPY',rows:[{symbol:'XLK',daily:[2]}],errors:[]});assert.equal(recovery.rows[0].stale,false);assert.deepEqual(recovery.rows[0].daily,[2]);
});
