import {withEma} from './chart-indicators.mjs';
export function liveDailyMetadata(payload, now=Date.now()) {
 const meta=payload?.chart?.result?.[0]?.meta||{};
 const zone=meta.exchangeTimezoneName||'UTC';
 const epoch=Number(meta.regularMarketTime), end=Number(meta.currentTradingPeriod?.regular?.end), start=Number(meta.currentTradingPeriod?.regular?.start);
 const valid=Number.isFinite(epoch)&&epoch>0;
 const tradingDate=valid?new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(epoch*1000)):null;
 return {quoteTime:valid?new Date(epoch*1000).toISOString():null,tradingDate,exchangeTimezone:zone,sessionComplete:Number.isFinite(end)&&end>0?(valid&&Number.isFinite(start)&&epoch<start)||now>=end*1000:null,source:'Yahoo Finance via MarketDataAdapter'};
}
export function entryChartCandles(bars,symbol,start,end) {
 const unique=new Map();
 for(const b of bars||[]) if(b.symbol===symbol&&b.date<=end&&[b.open,b.high,b.low,b.close].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)&&b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close))unique.set(b.date,b);
 const sorted=[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));
 return withEma(sorted.map((b,i)=>{
  const previous=sorted.slice(Math.max(0,i-20),i).map(c=>c.volume);
  const averageVolume20=previous.length===20&&previous.every(v=>v!=null&&Number.isFinite(v))?previous.reduce((s,v)=>s+v,0)/20:null;
  return {...b,phase:'CONTEXT',averageVolume20,volumeRatio:b.volume!=null&&averageVolume20>0?b.volume/averageVolume20:null};
 })).filter(b=>b.date>=start);
}
