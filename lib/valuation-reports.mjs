import {buildPerformanceDaily,performanceRange} from './performance-engine.mjs';
import {currencyTotal,convertCurrency,cycleValue,historicalFx} from './valuation.mjs';
import {recordDay,priorDay} from './performance-history.mjs';
export function currentValuation(equity,currency,fx){
 return {currency,total:currencyTotal(equity.assetByCurrency||{},currency,fx),cash:currencyTotal(equity.cashByCurrency||{},currency,fx),gross:convertCurrency(equity.grossPositionValueUsd,'USD',currency,fx)};
}
export function realizedValue(cycles,currency,fxBars){let total=0;for(const cycle of cycles){const value=cycleValue(cycle,cycle.pnl,currency,fxBars);if(value==null)return null;total+=value;}return total;}
export function periodValuation(data,cache,now,currency,total,kind){
 const daily=buildPerformanceDaily(data,cache,now,currency),end=now.toISOString().slice(0,10);
 const start=kind==='week'?new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-((now.getUTCDay()+6)%7))).toISOString().slice(0,10):kind==='month'?end.slice(0,7)+'-01':end.slice(0,4)+'-01-01';
 const before=priorDay(start),baseline=daily.points.find(p=>p.date===before);
 if(!baseline||baseline.total==null||total==null)return {rate:null,profit:null,problems:['缺期間起始或目前估值']};
 const points=daily.points.filter(p=>p.date>=start&&p.date<=end);if(points.some(p=>p.total==null||p.reset))return {rate:null,profit:null,problems:['期間行情缺漏或有期初餘額校正']};
 let flows=0,weighted=0;const fxBars=cache?.entries?.['USDTWD=X:raw']?.bars||[];const startTime=Date.parse(start),endTime=now.getTime();
 for(const row of data.cashActivities||[]){const date=recordDay(row);if(date<start||date>end)continue;if(row.requiresReview||row.type==='OPENING_BALANCE')return {rate:null,profit:null,problems:['期間資金活動待確認或期初校正']};if(!['DEPOSIT','WITHDRAWAL'].includes(row.type))continue;
  const value=convertCurrency(row.amount,row.currency,currency,historicalFx(fxBars,date));if(value==null)return {rate:null,profit:null,problems:['資金活動缺歷史匯率']};
  const amount=value*(row.type==='WITHDRAWAL'?-1:1);flows+=amount;weighted+=amount*Math.max(0,Math.min(1,(endTime-Date.parse(row.timestamp))/(endTime-startTime||1)));
 }
 const denominator=baseline.total+weighted,profit=total-baseline.total-flows;return {rate:denominator>0?profit/denominator:null,profit,problems:denominator>0?[]:['加權資金分母無效']};
}
export function historicalMonths(data,cache,now,currency,current){
 const daily=buildPerformanceDaily(data,cache,now,currency),fxBars=cache?.entries?.['USDTWD=X:raw']?.bars||[],cycles=current.cycles||[];
 const months=[...new Set(daily.points.map(p=>p.date.slice(0,7)))];const thisMonth=now.toISOString().slice(0,7);if(((data.cashActivities||[]).length||(data.fills||[]).length)&&!months.includes(thisMonth))months.push(thisMonth);
 let previous=null;
 return months.map(month=>{
  const points=daily.points.filter(p=>p.date.startsWith(month)),last=points.at(-1),isCurrent=month===thisMonth;const total=isCurrent?current.total:last?.total??null,date=isCurrent?now.toISOString().slice(0,10):last?.date;
  const closed=cycles.filter(c=>recordDay({timestamp:c.closeAt})<=date);const realized=realizedValue(closed,currency,fxBars);
  let deposit=0,withdrawal=0,bad=false;
  for(const row of data.cashActivities||[]){if(!recordDay(row).startsWith(month)||!['DEPOSIT','WITHDRAWAL'].includes(row.type))continue;const value=convertCurrency(row.amount,row.currency,currency,historicalFx(fxBars,recordDay(row)));if(value==null||row.requiresReview){bad=true;continue;}if(row.type==='DEPOSIT')deposit+=value;else withdrawal+=value;}
  const range=performanceRange(daily,priorDay(month+'-01'),date||month+'-01');
  const point={month,total,change:previous==null||total==null?null:total-previous,realized,deposit:bad?null:deposit,withdrawal:bad?null:withdrawal,return:range.summary.portfolio,benchmark:range.summary.QQQ,problems:[...new Set(points.flatMap(p=>p.problems))],isCurrent};previous=total;return point;
 });
}

export function cycleGroupValuation(cycles,currency,bars){
 const values=cycles.map(c=>cycleValue(c,c.pnl,currency,bars)),entries=cycles.map(c=>convertCurrency(c.entryNotional,c.currency||'USD',currency,historicalFx(bars,c.fills?.[0]?.tradeDate||recordDay({timestamp:c.openAt}))));
 const missing=values.filter(v=>v==null).length;
 return {total:missing?null:values.reduce((sum,v)=>sum+v,0),average:missing||!values.length?null:values.reduce((sum,v)=>sum+v,0)/values.length,entryAverage:entries.some(v=>v==null)||!entries.length?null:entries.reduce((sum,v)=>sum+v,0)/entries.length,missing};
}
