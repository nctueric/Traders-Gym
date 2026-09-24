import { positionDayChange } from './position-day-change.mjs';
export function heatmapItems(rows) {
  return rows.map(row => ({ id: row.position.id, position: row.position, value: row.metrics.marketValueUsd, rate: positionDayChange(row.position, row.quote).rate, updatedAt: row.quote?.updatedAt || null }));
}
export function normalizeHoldingsColorScheme(value) { return value === "red-up" ? "red-up" : "green-up"; }
export function heatmapColor(rate, scheme = "green-up") {
  if (rate == null || !Number.isFinite(rate)) return '#65716c';
  if (rate === 0) return '#596663';
  if (normalizeHoldingsColorScheme(scheme) === "red-up") rate = -rate;
  if (rate > 0) return rate >= .03 ? '#075c36' : rate >= .01 ? '#117747' : '#26865c';
  return rate <= -.03 ? '#8e2032' : rate <= -.01 ? '#b12d3b' : '#bd4550';
}
// Balanced binary rectangles preserve exact USD-value proportions, with no fake minimum areas.
export function layoutHoldings(items, width, height) {
  const valid=items.filter(i=>typeof i.value==='number' && Number.isFinite(i.value) && i.value>0).sort((a,b)=>b.value-a.value || String(a.id).localeCompare(String(b.id)));
  if (!(width>0 && height>0) || !valid.length) return [];
  const result=[];
  function split(group,x,y,w,h) {
    if(group.length===1){result.push({...group[0],x,y,width:w,height:h});return;}
    const total=group.reduce((s,i)=>s+i.value,0);let sum=0,k=1,best=Infinity;
    for(let i=1;i<group.length;i++){sum+=group[i-1].value;const delta=Math.abs(total/2-sum);if(delta<best){best=delta;k=i;}}
    const fraction=group.slice(0,k).reduce((s,i)=>s+i.value,0)/total;
    if(w>=h){split(group.slice(0,k),x,y,w*fraction,h);split(group.slice(k),x+w*fraction,y,w*(1-fraction),h);}
    else {split(group.slice(0,k),x,y,w,h*fraction);split(group.slice(k),x,y+h*fraction,w,h*(1-fraction));}
  }
  split(valid,0,0,width,height);return result;
}
