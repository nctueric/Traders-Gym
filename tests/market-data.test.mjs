import test from 'node:test';
import assert from 'node:assert/strict';
import {marketQuotes,marketHistory,publicMarket,yahooChart} from '../lib/market-data.mjs';
import {captured,TEST_NOW} from './market-fixture.mjs';
const request=(path,init)=>new Request('https://test.invalid'+path,init);
const fetcher=async input=>{const symbol=decodeURIComponent(new URL(input).pathname.split('/').at(-1));return captured[symbol]?Response.json(captured[symbol]):Response.json({}, {status:404});};
const options={fetcher,now:()=>Date.parse(TEST_NOW)};

test('shared market handlers preserve real source/time and distinct raw/adjusted prices',async()=>{
 const quote=await(await marketQuotes(request('/api/quotes?symbols=AAPL,2330.TW'),options)).json();assert.equal(quote.quotes.length,2);assert.equal(quote.quotes[0].updatedAt,new Date(captured.AAPL.chart.result[0].meta.regularMarketTime*1000).toISOString());
 const raw=await(await marketHistory(request('/api/history?symbol=SPY&priceBasis=raw'),options)).json(),adj=await(await marketHistory(request('/api/market/history?symbol=SPY&priceBasis=adjusted'),options)).json();assert.equal(raw.priceBasis,'raw');assert.equal(adj.priceBasis,'adjusted');assert.notEqual(raw.bars[0].close,adj.bars[0].close);
 const a=await(await marketHistory(request('/api/history?symbol=AAPL&mode=ohlc'),options)).json(),b=await(await marketHistory(request('/api/market/history?symbol=AAPL&mode=ohlc'),options)).json();assert.deepEqual(a,b);
 const live=await(await marketHistory(request('/api/market/history?symbol=AAPL&mode=ohlc&live=true'),options)).json();assert.equal(typeof live.live.sessionComplete,'boolean');assert.equal(live.live.source,'Yahoo Finance via MarketDataAdapter');
});
test('validation, unknown symbols, partial success and public 400-day boundary',async()=>{
 for(const url of ['/api/quotes?symbols=BAD%2FURL','/api/quotes?symbols='+Array.from({length:51},(_,i)=>'A'+i).join(',')])assert.equal((await marketQuotes(request(url),options)).status,400);
 for(const query of ['symbol=AAPL&start=2026-02-30&end=2026-03-01','symbol=AAPL&start=2026-03-01','symbol=AAPL&start=2026-04-01&end=2026-03-01','symbol=AAPL&mode=ohlc&priceBasis=adjusted','symbol=AAPL&priceBasis=bad','symbol=AAPL&start=2025-01-01&end=2026-10-07'])assert.equal((await marketHistory(request('/api/history?'+query),{...options,publicAccess:true})).status,400);
 const response=await marketQuotes(request('/api/quotes?symbols=AAPL,UNKNOWN'),options),partial=await response.json();assert.equal(partial.quotes.length,1);assert.equal(partial.errors.length,1);assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal((await marketHistory(request('/api/history?symbol=UNKNOWN'),options)).status,502);
});
test('public market is GET-only, limited before cache lookup, no account data or cached errors',async()=>{
 let puts=0;const cache={match:async()=>null,put:async()=>{puts++;}},allow={limit:async()=>({success:true})};
 assert.equal((await publicMarket(request('/api/market/quotes',{method:'PUT'}),marketQuotes,{limiter:allow,cache,...options})).status,405);
 assert.equal((await publicMarket(request('/api/market/quotes'),marketQuotes,{})).status,503);
 const limited=await publicMarket(request('/api/market/quotes'),marketQuotes,{limiter:{limit:async()=>({success:false})},cache,...options});assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'60');
 const response=await publicMarket(request('/api/market/quotes?symbols=AAPL'),marketQuotes,{limiter:allow,cache,...options});assert.equal(response.status,200);assert.equal(puts,1);assert.equal(response.headers.get('Set-Cookie'),null);
 await publicMarket(request('/api/market/quotes?symbols=UNKNOWN'),marketQuotes,{limiter:allow,cache,...options});assert.equal(puts,1);
 let key;const cachedResponse=await publicMarket(request('/api/market/quotes?symbols=AAPL',{headers:{'cf-connecting-ip':'127.0.0.2'}}),marketQuotes,{...options,limiter:{limit:async options=>{key=options.key;return {success:true};}},cache:{match:async()=>Response.json({cached:true})}});assert.equal(key,'market:127.0.0.2');cachedResponse.headers.set('x-framework-finalizer','safe');assert.equal(cachedResponse.headers.get('x-framework-finalizer'),'safe');
});
test('upstream global concurrency is bounded and timeout is abortable',async()=>{
 let active=0,max=0;const slow=async(_input,init)=>{active++;max=Math.max(max,active);try{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,10);init.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(init.signal.reason);},{once:true});});return Response.json(captured.AAPL);}finally{active--;}};
 await Promise.all(Array.from({length:9},()=>yahooChart('AAPL','range=1y',{fetcher:slow})));assert.equal(max,3);
 const keepAlive=setTimeout(()=>{},100);try{await assert.rejects(yahooChart('AAPL','range=1y',{fetcher:slow,timeoutMs:1}),{name:'TimeoutError'});}finally{clearTimeout(keepAlive);}
});

test('current-day daily requests expire in 15 seconds; cache faults retain real responses',async()=>{
 const today=await marketHistory(request('/api/history?symbol=AAPL'),options);
 assert.match(today.headers.get('Cache-Control'),/max-age=15,/);
 const closed=await marketHistory(request('/api/history?symbol=AAPL&start=2025-10-07&end=2026-10-06'),options);
 assert.match(closed.headers.get('Cache-Control'),/max-age=1800,/);
 const response=await publicMarket(request('/api/market/quotes?symbols=AAPL'),marketQuotes,{...options,limiter:{limit:async()=>({success:true})},cache:{match:async()=>{throw Error('cache unavailable');},put:async()=>{throw Error('cache unavailable');}}});
 assert.equal(response.status,200);assert.equal((await response.json()).quotes[0].price,captured.AAPL.chart.result[0].meta.regularMarketPrice);
});
