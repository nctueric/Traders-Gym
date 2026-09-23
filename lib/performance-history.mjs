import { toProviderSymbol } from './quote-engine.mjs';
import { performanceHistoryLookback } from './performance-market-closures.mjs';
import { missingHistoryRanges, mergeHistoryCoverage } from './history-coverage.mjs';
export const DAY = 86400000;
export const dayKey = value => String(value || '').slice(0,10);
export const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
// Explicit timestamps use UTC day boundaries, matching the ledger importer.
export const recordDay = row => {
 if (row.tradeDate) return row.tradeDate;
 const timestamp=String(row.timestamp||'');
 if (/T/.test(timestamp)&&/(Z|[+-]\d{2}:?\d{2})$/.test(timestamp)&&Number.isFinite(Date.parse(timestamp))) return new Date(timestamp).toISOString().slice(0,10);
 return dayKey(timestamp);
};
export const priorDay = value => new Date(Date.parse(value)-DAY).toISOString().slice(0,10);
export function performanceRequests(data, now = new Date()) {
 const end=priorDay(now.toISOString().slice(0,10));
 const records=[...(data.fills||[]),...(data.cashActivities||[])];
 const dates=records.map(recordDay).filter(d=>validDay(d)&&d<=end).sort();
 if(!dates.length)return [];
 const start=new Date(Date.parse(dates[0])-8*DAY).toISOString().slice(0,10);
 const targets=new Map([['QQQ:adjusted',{symbol:'QQQ',basis:'adjusted',start,end}],['SPY:adjusted',{symbol:'SPY',basis:'adjusted',start,end}]]);
 const holdings=new Map();
 for(const f of [...(data.fills||[])].sort((a,b)=>recordDay(a).localeCompare(recordDay(b)))){
  const date=recordDay(f);if(!validDay(date)||date>end)continue;
  const symbol=toProviderSymbol(f.symbol,f.market||f.exchange),key=JSON.stringify([f.accountId,symbol]),previous=holdings.get(key)||{symbol,quantity:0,start:new Date(Date.parse(date)-8*DAY).toISOString().slice(0,10),last:date};
  previous.quantity+=(f.side==='BUY'?1:-1)*Number(f.quantity);previous.last=date;holdings.set(key,previous);
 }
 for(const h of holdings.values()){const symbol=h.symbol,key=symbol+':raw',old=targets.get(key),stop=Math.abs(h.quantity)>1e-9?end:h.last;targets.set(key,{symbol,basis:'raw',start:old&&old.start<h.start?old.start:h.start,end:old&&old.end>stop?old.end:stop});}
 if(records.some(r=>r.currency==='TWD'))targets.set('USDTWD=X:raw',{symbol:'USDTWD=X',basis:'raw',start,end});
 return [...targets.values()];
}
// Dedicated derived-data cache; never merged into fills, reviews or OHLC ledger data.
export async function loadPerformanceHistory(targets, saved, fetcher, signal, progress) {
 let entries={...(saved?.entries||{})};const errors=[];
 let complete=0;
 for(const target of targets){
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const key=target.symbol+':'+target.basis,raw=entries[key];
  const entry=Array.isArray(raw?.bars)&&Array.isArray(raw?.coverage)?raw:{bars:[],coverage:[]};
  const ranges=missingHistoryRanges({...target,market:target.basis},entry.bars.length?entry.coverage:[]);
  // Bounded requests keep multi-year histories manageable without truncating them.
  const chunks=[];
  for(const range of ranges){let start=range.start;while(start<=range.end){const end=new Date(Math.min(Date.parse(range.end),Date.parse(start)+364*DAY)).toISOString().slice(0,10);chunks.push({start,end});start=new Date(Date.parse(end)+DAY).toISOString().slice(0,10);}}
  let bars=entry.bars,coverage=entry.coverage;
  for(const range of chunks){
   try {
    // Include seven days, or the verified pre-closure session for longer
    // holidays, to fetch a real preceding quote without inventing prices.
    const lookupStart=performanceHistoryLookback(target.symbol,range.start);
    const query=new URLSearchParams({symbol:target.symbol,start:lookupStart,end:range.end,priceBasis:target.basis});
    const response=await fetcher('/api/history?'+query,{signal});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();
    if(payload.priceBasis!==target.basis || !Array.isArray(payload.bars) || !payload.bars.length)throw new Error(target.basis==='adjusted'?'缺調整後收盤價':'缺收盤價');
    const fresh=payload.bars.filter(b=>validDay(b.date)&&typeof b.close==='number'&&Number.isFinite(b.close)&&b.close>0&&b.date>=lookupStart&&b.date<=range.end);
    if(!fresh.length)throw new Error('期間內無有效價格');
    bars=[...new Map([...bars,...fresh].map(b=>[b.date,{date:b.date,close:b.close}])).values()].sort((a,b)=>a.date.localeCompare(b.date));
    coverage=mergeHistoryCoverage(coverage,[{...range,symbol:target.symbol,market:target.basis,fetchedAt:new Date().toISOString()}]);
   }catch(error){if(signal.aborted)throw error;errors.push(`${target.symbol} ${range.start}～${range.end}：${error.message}`);}
  }
  entries[key]={bars,coverage};progress?.(++complete,targets.length);
 }
 return {cache:{version:1,entries},errors};
}
