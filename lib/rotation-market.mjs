import {yahooChart,MARKET_SOURCE} from './market-data.mjs';
import {CALENDAR_VERSION,easternTime,sessionState,sessionClose,shiftDay,tradingDay} from './rotation-calendar.mjs';
import {ROTATION_UNIVERSE,SECTOR_SYMBOLS,BENCHMARKS,ROTATION_VERSION,alignPeriods,rotationSeries} from './rotation-engine.mjs';
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const fullCache=new Map(),recentCache=new Map(),inflight=new Map();
// A shared request is aborted only after its final consumer leaves.
async function shared(key,job,signal) {
 signal?.throwIfAborted();let entry=inflight.get(key);
 if(!entry){const controller=new AbortController();entry={controller,users:0};entry.promise=job(controller.signal).finally(()=>inflight.delete(key));inflight.set(key,entry);}
 entry.users++;
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(fn,value)=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);entry.users--;if(!entry.users)entry.controller.abort();fn(value);};
  const abort=()=>finish(reject,signal.reason);
  signal?.addEventListener('abort',abort,{once:true});entry.promise.then(v=>finish(resolve,v),e=>finish(reject,e));
 });
}
export function normalizeRotationPayload(payload,now=Date.now()) {
 const result=payload?.chart?.result?.[0];if(!result||result.meta?.currency!=='USD')throw Error('缺有效美元行情');
 const raw=result.indicators?.quote?.[0]?.close,adjusted=result.indicators?.adjclose?.[0]?.adjclose;
 if(!Array.isArray(adjusted)||!Array.isArray(raw)||!Array.isArray(result.timestamp))throw Error('缺調整後價格，無法計算輪動');
 const rows=new Map();
 result.timestamp.forEach((epoch,i)=>{
  if(!Number.isFinite(epoch))return;
  const date=easternTime(epoch*1000).date;
  rows.set(date,{date,close:positive(adjusted[i])?adjusted[i]:null,raw:positive(raw[i])?raw[i]:null});
 });
 const quoteEpoch=result.meta.regularMarketTime;
 const quoteTime=Number.isFinite(quoteEpoch)&&quoteEpoch>0?quoteEpoch*1000:null;
 return {bars:[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date)),quote:positive(result.meta.regularMarketPrice)?result.meta.regularMarketPrice:null,quoteTime,fetchedAt:now};
}
export function reconcileRotationBars(history,recent) {
 const overlap=new Map(history.map(b=>[b.date,b]));
 const factors=recent.flatMap(b=>positive(b.close)&&positive(overlap.get(b.date)?.close)?[b.close/overlap.get(b.date).close]:[]);
 if(!factors.length)throw Error('歷史與最新資料沒有共同調整基準');
 // The latest, still changing day must not define a historical scale correction.
 const ratios=recent.slice(0,-1).flatMap(b=>positive(b.close)&&positive(overlap.get(b.date)?.close)?[b.close/overlap.get(b.date).close]:[]);
 if(!ratios.length)throw Error('無法核對已完成期間的調整因子');
 const factor=ratios.at(-1);
 if(ratios.some(r=>Math.abs(r/factor-1)>1e-5))throw Error('價格調整基準改變，需要重新載入歷史');
 const merged=new Map(history.map(b=>[b.date,{...b,close:positive(b.close)?b.close*factor:null}]));
 for(const b of recent)merged.set(b.date,b);
 return [...merged.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
async function loadSymbol(symbol,{now,start,state,signal,fetcher,cache=fullCache,latestCache=recentCache}) {
 const stamp=`${state.date}:${state.lastCompleted}:${Math.floor(now/1800000)}`;
 let historical=cache.get(symbol);
 if(!historical||historical.stamp!==stamp){
  const query=new URLSearchParams({interval:'1d',period1:String(Date.parse(start)/1000),period2:String(Math.floor(now/1000)),events:'div,splits'}).toString();
  historical=await shared(`history:${symbol}:${stamp}`,async sharedSignal=>{
   const value=normalizeRotationPayload(await yahooChart(symbol,query,{fetcher,signal:sharedSignal,timeoutMs:45000,ttl:60}),now);
   const row={...value,stamp};cache.set(symbol,row);latestCache.set(symbol,row);return row;
  },signal);
 }
 let latest=latestCache.get(symbol);
 if(!latest||now-latest.fetchedAt>=60000){
  latest=await shared(`latest:${symbol}:${Math.floor(now/60000)}`,async sharedSignal=>{
   const value=normalizeRotationPayload(await yahooChart(symbol,'interval=1d&range=5d&events=div%2Csplits',{fetcher,signal:sharedSignal,timeoutMs:45000,ttl:30}),now);latestCache.set(symbol,value);return value;
  },signal);
 }
 let bars;
 try {bars=latest===historical?historical.bars:reconcileRotationBars(historical.bars,latest.bars);}
 catch {
  cache.delete(symbol);latestCache.delete(symbol);
  // One full reload on an adjustment mismatch; no mixing of incompatible series.
  const query=new URLSearchParams({interval:'1d',period1:String(Date.parse(start)/1000),period2:String(Math.floor(now/1000)),events:'div,splits'}).toString();
  const fresh=normalizeRotationPayload(await yahooChart(symbol,query,{fetcher,signal,timeoutMs:45000,ttl:0}),now);
  cache.set(symbol,{...fresh,stamp});latestCache.set(symbol,fresh);latest=fresh;bars=fresh.bars;
 }
 return {...latest,bars:bars.filter(b=>b.date>=start&&b.date<=state.date)};
}
export function coherentPreview(asset,benchmark,now) {
 const state=sessionState(now);
 const valid=row=>row.quoteTime!=null&&row.quoteTime<=now+30000&&now-row.quoteTime<=20*60000&&easternTime(row.quoteTime).date===state.date&&positive(row.quote)&&row.bars.some(b=>b.date===state.date&&positive(b.raw)&&positive(b.close));
 return state.open&&valid(asset)&&valid(benchmark)&&Math.abs(asset.quoteTime-benchmark.quoteTime)<=120000;
}
function withPreview(row,state,enabled) {
 const bars=row.bars.filter(b=>b.date<=state.lastCompleted);
 if(enabled){const current=row.bars.find(b=>b.date===state.date);bars.push({date:state.date,close:row.quote*current.close/current.raw});}
 return bars;
}
export async function marketRotation(request,options={}) {
 const fail=(error,status=400)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='GET')return fail('只支援讀取市場資料',405);
 const params=new URL(request.url).searchParams,benchmark=params.get('benchmark')||'SPY',interval=params.get('interval')||'weekly',mode=params.get('mode')||'history';
 const symbols=[...new Set((params.get('symbols')||SECTOR_SYMBOLS.join(',')).split(',').map(s=>s.trim().toUpperCase()))];
 if([...params.keys()].some(k=>!['benchmark','interval','mode','symbols'].includes(k))||!BENCHMARKS.includes(benchmark)||!['daily','weekly'].includes(interval)||!['history','latest'].includes(mode)||!symbols.length||symbols.length>23||symbols.some(s=>!ROTATION_UNIVERSE.some(r=>r.symbol===s)))return fail('請選擇有效的基準、週期與板塊標的');
 try {
  const now=options.now?.()??Date.now(),state=sessionState(now),year=Number(state.date.slice(0,4));
  const start=`${year-3}${state.date.slice(4)}`.replace(/-02-29$/,'-02-28'),displayStart=`${year-2}${state.date.slice(4)}`.replace(/-02-29$/,'-02-28');
  const context={...options,now,start,state,signal:request.signal};
  const base=await loadSymbol(benchmark,context);
  // A stale benchmark cannot certify a newly completed daily candle.
  let completedThrough=state.lastCompleted;
  if(base.quoteTime==null)throw Error('基準缺行情時間，無法核對資料新鮮度');
  const baseTime=easternTime(base.quoteTime);
  if(baseTime.date<completedThrough)throw Error('基準行情尚未更新至最近完成交易日');
  if(baseTime.date===completedThrough&&baseTime.minute<sessionClose(completedThrough)-2){do{completedThrough=shiftDay(completedThrough,-1);}while(!tradingDay(completedThrough));}
  const alignedState={...state,lastCompleted:completedThrough};
  const errors=[],warnings=[];
  const rows=await Promise.all(symbols.map(async symbol=>{
   try {
    const asset=await loadSymbol(symbol,context),preview=coherentPreview(asset,base,now);
    const assetTime=asset.quoteTime?easternTime(asset.quoteTime):null;
    if(!assetTime||assetTime.date<completedThrough||(assetTime.date===completedThrough&&assetTime.minute<sessionClose(completedThrough)-2))throw Error('行情時間落後，暫停此標的排名');
    if(state.open&&!preview)warnings.push({symbol,message:'盤中預覽暫不可用：調整價或行情時間未對齊'});
    const a=withPreview(asset,alignedState,preview),b=withPreview(base,alignedState,preview),end=preview?state.date:completedThrough;
    const build=frequency=>rotationSeries(alignPeriods(a,b,{start,end,interval:frequency,completedThrough})).filter(p=>p.date>=displayStart);
    return {symbol,...ROTATION_UNIVERSE.find(r=>r.symbol===symbol),quoteTime:new Date(asset.quoteTime).toISOString(),preview,daily:build('daily'),weekly:build('weekly')};
   }catch(e){errors.push({symbol,message:e.message});return null;}
  }));
  return Response.json({version:ROTATION_VERSION,calendarVersion:CALENDAR_VERSION,benchmark,interval,mode,source:MARKET_SOURCE,marketOpen:state.open,tradingDate:state.date,completedThrough,displayStart,fetchedAt:new Date(now).toISOString(),quoteTime:new Date(base.quoteTime).toISOString(),rows:rows.filter(Boolean),errors,warnings,refreshAfterSeconds:60},{headers:{'Cache-Control':errors.length||warnings.length?'no-store':'public, max-age=30, s-maxage=30'}});
 }catch(e){return fail(e.name==='TimeoutError'?'行情讀取逾時，請重試':e.message,502);}
}
