import {sessionState} from './rotation-calendar.mjs';
export function shouldRefreshRotation({visible,latest,now=Date.now()}) {
 try{return visible&&latest&&sessionState(now).open;}catch{return false;}
}
export function mergeRotationSnapshot(previous,incoming) {
 if(!previous||previous.benchmark!==incoming.benchmark)return incoming;
 const rows=new Map(incoming.rows.map(r=>[r.symbol,{...r,stale:false}]));
 for(const error of incoming.errors) {
  const old=previous.rows.find(r=>r.symbol===error.symbol);
  if(old)rows.set(error.symbol,{...old,stale:true});
 }
 return {...incoming,rows:[...rows.values()]};
}
export function visibleRotationSeries(row,interval,asOf,preview) {
 return row[interval].filter(p=>p.date<=asOf&&(p.complete||preview));
}
