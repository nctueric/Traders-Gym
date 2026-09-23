import {buildCycles} from './trade-engine.mjs';

export function historicalEntryStandard(data, timestamp) {
 const cutoff=new Date(timestamp).getTime();
 const cycles=buildCycles({fills:(data.fills||[]).filter(f=>new Date(f.timestamp).getTime()<cutoff),marketBars:[]}).cycles
  .filter(c=>new Date(c.closeAt).getTime()<cutoff&&typeof c.returnPct==='number'&&Number.isFinite(c.returnPct));
 const winners=cycles.filter(c=>c.pnl>0&&c.returnPct>0),losers=cycles.filter(c=>c.pnl<0&&c.returnPct<0);
 const average=rows=>rows.length?rows.reduce((sum,c)=>sum+c.returnPct,0)/rows.length:null;
 const winRate=average(winners),lossRate=average(losers);
 return {cutoff:Number.isFinite(cutoff)?new Date(cutoff).toISOString():null,winnerCount:winners.length,loserCount:losers.length,averageWinRate:winRate,averageLossRate:lossRate,stopFraction:0.5};
}
export function resolveEntryPlan(draft,preview,standard) {
 const base=preview.after?.averageCost,direction=preview.after?.direction==='SHORT'?-1:1;
 const result={...draft,formatVersion:2,planModes:{},standardSnapshot:{...standard,averageCost:base??null,direction:preview.after?.direction??null,sources:{}}};
 for(const field of ['stopLoss','takeProfit']) {
  const explicit=draft.planModes?.[field];
  const mode=explicit||(draft[field]!==undefined?'MANUAL':['ENTRY','REVERSAL'].includes(preview.action)?'STANDARD':'ORIGINAL');
  const rate=field==='takeProfit'?standard.averageWinRate:standard.averageLossRate==null?null:standard.averageLossRate*0.5;
  const computed=base>0&&rate!=null?base*(1+direction*rate):null;
  result[field]=!preview.after?'':mode==='STANDARD'?(computed>0?String(Number(computed.toPrecision(8))):''):mode==='ORIGINAL'?(preview.plan?.[field]??''):(draft[field]??'');
  result[field==='stopLoss'?'stopBasis':'targetBasis']=result[field]===''?'UNSET':mode==='STANDARD'?'HISTORICAL_STANDARD':mode==='ORIGINAL'?'ORIGINAL':'CUSTOM';
  result.standardSnapshot.sources[field]=mode;
  result.planModes[field]=mode;
 }
 return result;
}
