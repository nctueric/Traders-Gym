export function chartPlanDate(model, candles, selectedId, latest) {
  const visibleDate=candles.at(-1)?.date || model.windowStart;
  const selected=model.events?.find(e=>e.id===selectedId);
  if(selected?.date > visibleDate)return selected.date;
  return model.status==='OPEN' && latest && !selectedId ? model.windowEnd || visibleDate : visibleDate;
}
const valid = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
export function chartPriceLines(model, date, selectedId, history = false) {
  const events = (model.events || []).filter(e => !e.legacy && ['PLAN_STOP','PLAN_TARGET'].includes(e.type) && e.date <= date);
  const latest = new Map();
  for (const e of [...events].sort((a,b)=>String(a.timestamp || a.date).localeCompare(String(b.timestamp || b.date)))) latest.set(e.type,e);
  const selected = events.find(e=>e.id===selectedId);
  const plans = history ? events : [...latest.values(), ...(selected && ![...latest.values()].includes(selected) ? [selected] : [])];
  const lines = plans.filter(e=>valid(e.price)).map(e=>({...e,label:e.label || (e.type==='PLAN_STOP'?'停損':'停利'),color:e.type==='PLAN_STOP'?'#b43f35':'#176b50',dash:e.type==='PLAN_STOP'?[3,3]:[8,4],source:e.source || '已保存計畫',endDate:events.filter(n=>n.type===e.type&&(n.timestamp||n.date)>(e.timestamp||e.date)).sort((a,b)=>String(a.timestamp||a.date).localeCompare(String(b.timestamp||b.date)))[0]?.date}));
  if(valid(model.averageEntry)) lines.push({price:model.averageEntry,label:'持倉均價',color:'#786099',dash:[2,4],source:'FIFO'});
  lines.push(...(model.overlays || []).filter(e=>valid(e.price)).map((e,i)=>({...e,dash:e.dash || [[2,2],[2,4],[3,3],[8,4]][i%4]})));
  const grouped=new Map();
  for(const line of lines){const prior=grouped.get(line.price);if(prior){prior.label+='／'+line.label;prior.details.push(line);}else grouped.set(line.price,{...line,details:[line]});}
  return [...grouped.values()];
}
export function chartPriceRange(candles, enabledEma, lines, showAll=false) {
  const prices=candles.flatMap(c=>[c.low,c.high,...enabledEma.map(p=>c.ema?.[p])]).concat(showAll?lines.map(l=>l.price):[]).filter(valid);
  if(!prices.length)return {low:0,high:1};
  const min=Math.min(...prices),max=Math.max(...prices),spread=Math.max(max-min,max*.04,Number.EPSILON);
  return {low:min-spread*.08,high:max+spread*.08};
}
export function layoutPriceLabels(lines,g) {
  const rows=lines.map(line=>{const actual=g.top+(g.high-line.price)/(g.high-g.low)*(g.priceBottom-g.top);return {...line,actualY:Math.min(g.priceBottom,Math.max(g.top,actual)),edge:actual<g.top?'above':actual>g.priceBottom?'below':null};}).sort((a,b)=>a.actualY-b.actualY);
  // Bound label count to the available height while preserving full detail.
  const capacity=Math.max(1,Math.floor((g.priceBottom-g.top)/20));
  const groups=[];
  // Collapse crowded historical prices into an accessible detail label, never overlap.
  const groupSize=Math.max(1,Math.ceil(rows.length/capacity));
  for(let i=0;i<rows.length;i+=groupSize){const members=rows.slice(i,i+groupSize);const row=members[0];groups.push(members.length===1?row:{...row,label:`歷史價位 ${members.length} 項`,details:members.flatMap(m=>m.details)});}
  const ys=[];for(const r of groups)ys.push(Math.max(r.actualY,ys.length?ys.at(-1)+20:g.top));
  if(ys.at(-1)>g.priceBottom){ys[ys.length-1]=g.priceBottom;for(let j=ys.length-2;j>=0;j--)ys[j]=Math.min(ys[j],ys[j+1]-20);}
  return groups.map((row,i)=>({...row,y:ys[i]}));
}
