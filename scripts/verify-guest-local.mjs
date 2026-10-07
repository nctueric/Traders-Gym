// Read-only local acceptance: public prices only, no account writes or credentials.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createDemoRuntime} from '../lib/demo-workspace.mjs';
import {summarize,validateDataset} from '../lib/trade-engine.mjs';
const origin=process.argv[2]||'http://127.0.0.1:3107';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))throw Error('This verifier only accepts an isolated localhost service');
const rows=[];
for(const path of ['/api/trade-records','/api/ledgers','/api/admin/accounts','/api/review-valuations','/api/quotes?symbols=AAPL']){
 const response=await fetch(origin+path);assert.ok([401,403].includes(response.status),path);rows.push({path,status:response.status,privateAccessDenied:true});
}
const runtime=createDemoRuntime({origin,networkFetch:(path,init)=>fetch(origin+path,init)});
await runtime.initialize();const data=runtime.read(),summary=summarize(data);assert.deepEqual(validateDataset(data),[]);assert.equal(summary.cycles.length,150);assert.equal(summary.positions.length,2);
for(const fill of data.fills){assert.equal(fill.price,data.marketBars.find(b=>b.symbol===fill.symbol&&b.date===fill.tradeDate).close);}
const quoteResponse=await runtime.fetcher('/api/quotes?symbols=AAPL,2330.TW,USDTWD=X,NVDA');assert.equal(quoteResponse.status,200);const payload=await quoteResponse.json();assert.equal(payload.quotes.length,4);assert.equal(payload.errors.length,0);
const repeated=await runtime.fetcher('/api/quotes?symbols=AAPL,2330.TW,USDTWD=X,NVDA');assert.equal(repeated.status,200);assert.deepEqual((await repeated.json()).quotes,payload.quotes);
const invalid=await fetch(origin+'/api/market/history?symbol=AAPL&start=2024-01-01&end=2026-10-07');assert.equal(invalid.status,400);
const sources=Object.values(data.marketSnapshot.quotes).map(q=>({symbol:q.symbol,price:q.price,updatedAt:q.updatedAt,source:q.source}));
const result={verifiedAt:new Date().toISOString(),origin,readOnly:true,privateChecks:rows,initialFills:data.fills.length,cycles:summary.cycles.length,positions:summary.positions.length,qualityIssues:summary.issues,warnings:data.demoWarnings,sourceQuotes:sources,additionalSymbol:'NVDA',fillClosesVerified:true,cacheHitVerified:true,overlongHistoryStatus:invalid.status};
await mkdir('docs/acceptance/guest-market-20261007',{recursive:true});await writeFile('docs/acceptance/guest-market-20261007/http.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({fills:data.fills.length,cycles:summary.cycles.length,positions:summary.positions.length,warnings:data.demoWarnings,privateChecks:rows.length,additionalSymbol:'NVDA',sourceQuotes:sources},null,2));
