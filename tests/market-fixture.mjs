import {readFileSync} from 'node:fs';
import {marketQuotes,marketHistory} from '../lib/market-data.mjs';
import {normalizeYahooChart,normalizeYahooOhlcHistory,normalizePerformanceHistory} from '../lib/quote-engine.mjs';
export const TEST_NOW='2026-10-07T12:00:00.000Z';
export const captured=Object.fromEntries(['AAPL','MSFT','2330.TW','QQQ','SPY','USDTWD=X'].map(s=>[s,JSON.parse(readFileSync(new URL(`./fixtures/market/${s}.json`,import.meta.url)))]));
export const fixtureOptions=()=>({now:TEST_NOW,quotes:Object.fromEntries(Object.entries(captured).map(([s,p])=>[s,normalizeYahooChart(s,p)])),series:Object.fromEntries(Object.entries(captured).map(([s,p])=>{const symbol=s==='2330.TW'?'2330':s;return [symbol,{bars:['AAPL','MSFT','2330.TW'].includes(s)?normalizeYahooOhlcHistory(symbol,p):normalizePerformanceHistory(symbol,p,s==='USDTWD=X'?'raw':'adjusted'),source:'Yahoo Finance via MarketDataAdapter',fetchedAt:TEST_NOW}];}))});
export function fixtureNetwork(calls=[],clock=()=>Date.parse(TEST_NOW)){
 const upstream=async(input,init)=>{init.signal?.throwIfAborted();const symbol=decodeURIComponent(new URL(input).pathname.split('/').at(-1));return captured[symbol]?Response.json(captured[symbol]):Response.json({error:'unknown symbol'},{status:404});};
 return async(input,init={})=>{calls.push({input,init});const request=new Request(new URL(input,'https://demo.invalid'),init);if(request.url.includes('/api/market/quotes?'))return marketQuotes(request,{fetcher:upstream,now:clock});if(request.url.includes('/api/market/history?'))return marketHistory(request,{fetcher:upstream,now:clock,publicAccess:true});throw Error('Fixture refuses private requests');};
}
