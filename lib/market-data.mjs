import { normalizeYahooChart, normalizeYahooHistory, normalizeYahooOhlcHistory, normalizePerformanceHistory } from './quote-engine.mjs';
import { liveDailyMetadata } from './entry-market.mjs';

export const MARKET_SOURCE = 'Yahoo Finance via MarketDataAdapter';
const SYMBOL = /^[A-Z0-9.^=-]{1,20}$/;
const DAY = 86400000;
const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const failure = (error, status = 400, headers = {}) => Response.json({error}, {status, headers:{'Cache-Control':'no-store', ...headers}});
let running = 0;
const waiting = [];
async function bounded(job, signal) {
 if (running >= 3) await new Promise((resolve,reject) => {
  const entry = {resolve:() => {signal?.removeEventListener('abort', abort);resolve();}};
  const abort = () => {const index=waiting.indexOf(entry);if(index>=0)waiting.splice(index,1);reject(signal.reason);};
  signal?.throwIfAborted();waiting.push(entry);signal?.addEventListener('abort',abort,{once:true});
 });
 else running++;
 try {signal?.throwIfAborted();return await job();}
 finally {const next=waiting.shift();if(next)next.resolve();else running--;}
}
export async function yahooChart(symbol, query, {fetcher=globalThis.fetch, signal, timeoutMs=10000, ttl=15}={}) {
 const deadline=AbortSignal.timeout(timeoutMs), combined=signal?AbortSignal.any([signal,deadline]):deadline;
 return bounded(async () => {
  let lastError='行情讀取失敗';
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']) {
   combined.throwIfAborted();
   try {
    const response=await fetcher(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`,{
     signal:combined, headers:{'User-Agent':'Mozilla/5.0 TraderGym/2.5','Accept':'application/json'}, cf:{cacheEverything:true,cacheTtl:ttl},
    });
    if(!response.ok){lastError=`HTTP ${response.status}`;continue;}
    return await response.json();
   } catch(error) {combined.throwIfAborted();lastError=error.message;}
  }
  throw new Error(lastError);
 },combined);
}
export async function marketQuotes(request, options={}) {
 const symbols=[...new Set((new URL(request.url).searchParams.get('symbols')||'').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean))];
 if(symbols.length>50||symbols.some(s=>!SYMBOL.test(s)))return failure('每批最多 50 個有效標的');
 const fetchedAt=new Date(options.now?.()??Date.now()).toISOString();
 const rows=await Promise.all(symbols.map(async symbol=>{
  try {const payload=await yahooChart(symbol,'interval=1m&range=1d',{...options,signal:request.signal});return {quote:{...normalizeYahooChart(symbol,payload),fetchedAt}};}
  catch(error){return {error:{symbol,message:error.name==='TimeoutError'?'行情讀取逾時':error.message}};}
 }));
 const errors=rows.flatMap(r=>r.error?[r.error]:[]);
 return Response.json({quotes:rows.flatMap(r=>r.quote?[r.quote]:[]),errors,fetchedAt,refreshAfterSeconds:30},{headers:{'Cache-Control':errors.length?'no-store':'public, max-age=15, s-maxage=15'}});
}
export async function marketHistory(request, options={}) {
 const params=new URL(request.url).searchParams;
 const symbol=(params.get('symbol')||'').trim().toUpperCase(),datasetSymbol=(params.get('datasetSymbol')||symbol).trim().toUpperCase();
 const mode=params.get('mode')==='ohlc'?'ohlc':'close',basis=params.get('priceBasis'),live=params.get('live')==='true';
 const start=params.get('start')||'',end=params.get('end')||'';
 if(!SYMBOL.test(symbol)||!SYMBOL.test(datasetSymbol))return failure('標的代號格式無效');
 if(basis&&!['raw','adjusted'].includes(basis))return failure('價格口徑無效');
 if(live&&(mode!=='ohlc'||(basis&&basis!=='raw')))return failure('即時更新只支援原始日 OHLC');
 if(mode==='ohlc'&&basis==='adjusted')return failure('OHLC 僅支援原始價格');
 if((start&&!validDay(start))||(end&&!validDay(end))||!!start!==!!end||(start&&start>end))return failure('歷史行情日期格式或區間無效');
 if(options.publicAccess&&start&&Date.parse(end)-Date.parse(start)>399*DAY)return failure('每段歷史行情最多 400 日');
 const now=options.now?.()??Date.now(),today=new Date(now).toISOString().slice(0,10),effectiveEnd=end&&end<today?end:today;
 if(start&&start>effectiveEnd)return failure('起始日期尚未發生');
 const query=new URLSearchParams({interval:'1d',events:'history'});
 if(start){query.set('period1',String(Date.parse(start)/1000));query.set('period2',String(Math.floor(Math.min(Date.parse(effectiveEnd)+DAY,now)/1000)));}
 else query.set('range','1y');
 try {
  const ttl=live||effectiveEnd===today?15:1800,payload=await yahooChart(symbol,query,{...options,signal:request.signal,ttl});
  const bars=(mode==='ohlc'?normalizeYahooOhlcHistory(datasetSymbol,payload):basis?normalizePerformanceHistory(datasetSymbol,payload,basis):normalizeYahooHistory(datasetSymbol,payload))
   .filter(b=>(!start||b.date>=start)&&b.date<=effectiveEnd).map(b=>({...b,source:MARKET_SOURCE}));
  if(!bars.length)return failure('期間內無有效行情',502);
  return Response.json({...(live?{live:liveDailyMetadata(payload,now)}:{}),symbol:datasetSymbol,providerSymbol:symbol,...(basis?{priceBasis:basis}:{}),firstDate:bars[0].date,lastDate:bars.at(-1).date,bars,source:MARKET_SOURCE,fetchedAt:new Date(now).toISOString()},{headers:{'Cache-Control':`public, max-age=${ttl}, s-maxage=${ttl}`}});
 }catch(error){return failure(error.name==='TimeoutError'?'行情讀取逾時':error.message,502);}
}
// Public routes have no account lookup and cache only successful, non-personal data.
export async function publicMarket(request, handler, {limiter,cache,...options}={}) {
 if(request.method!=='GET')return failure('只支援讀取市場資料',405,{Allow:'GET'});
 if(!limiter)return failure('市場服務節流尚未設定',503);
 const {success}=await limiter.limit({key:`market:${request.headers.get('cf-connecting-ip')||'local'}`});
 if(!success)return failure('行情請求過多，請稍後重試',429,{'Retry-After':'60'});
 const url=new URL(request.url);url.searchParams.sort();
 const key=new Request(url.toString(),{method:'GET'});
 const cached=await cache?.match(key).catch(()=>undefined);if(cached)return new Response(cached.body,cached);
 const response=await handler(request,{...options,publicAccess:true});
 if(response.ok&&response.headers.get('Cache-Control')!=='no-store')await cache?.put(key,response.clone()).catch(()=>undefined);
 return response;
}
