import { buildMonthReturn } from './ytd-return.mjs';
import { buildMonthlyAssetPoint } from './monthly-assets.mjs';
export function benchmarkMonthReturn(bars, start, end) {
 const valid = bars.filter(b => typeof b.close === 'number' && Number.isFinite(b.close) && b.close > 0 && /^\d{4}-\d{2}-\d{2}$/.test(b.date)).sort((a,b)=>a.date.localeCompare(b.date));
 const before=valid.filter(b=>b.date<start).at(-1), last=valid.filter(b=>b.date>=start && b.date<=end).at(-1);
 if(!before || !last || Date.parse(start)-Date.parse(before.date)>7*86400000 || Date.parse(end)-Date.parse(last.date)>7*86400000) return {rate:null, date:last?.date||null};
 return {rate:last.close/before.close-1,date:last.date};
}
export function buildMonthComparison(data,equity,fx,bars) {
 const now=new Date(equity.asOf), start=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1);
 return [new Date(start-1),now].map((end,index)=>{
  const month=end.toISOString().slice(0,7);
  const point=index===0?buildMonthlyAssetPoint(data,month,fx,{},now):null;
  const closing=point?{totalUsd:point.totalUsd,unpricedPositionCount:point.estimatedSymbols.length+point.staleSymbols.length}:equity;
  const portfolio=buildMonthReturn(data,closing,fx,end);
  return {month,portfolio:portfolio.rate,profitUsd:portfolio.profitUsd,problems:portfolio.problems,benchmark:benchmarkMonthReturn(bars,month+'-01',end.toISOString().slice(0,10)),partial:index===1};
 });
}
