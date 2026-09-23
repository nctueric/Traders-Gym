import { inspectChartPoint } from './chart-indicators.mjs';
export const PRICE_FIELDS = ['close','open','high','low'];
export const PRICE_LABELS = {close:'收盤',open:'開盤',high:'最高',low:'最低'};
export function candlePrices(candle) {
  const raw = candle?.rawOhlc ?? candle;
  return PRICE_FIELDS.filter(field=>typeof raw?.[field]==='number' && Number.isFinite(raw[field]) && raw[field]>0)
    .map(field=>({date:candle.date,field,price:raw[field]}));
}
export function snapRulerPoint(g,candles,x,y) {
  const hit=inspectChartPoint(g,candles.length,x,y);
  if(!hit || hit.price===null)return null;
  let best=null, distance=Infinity;
  for(const option of candlePrices(candles[hit.index])){
    const pixel=g.top+(g.high-option.price)/(g.high-g.low)*(g.priceBottom-g.top);
    const next=Math.abs(pixel-y);
    if(next<distance-1e-8){best={...option,index:hit.index};distance=next;}
  }
  return best;
}
export function rulerResult(base,target) {
  if(!base || !target || !(base.price>0))return null;
  const difference=target.price-base.price;
  return {difference,percent:difference/base.price*100};
}
export function keyboardRulerPoint(candles,current,key) {
  let index=current?.index??candles.length-1;
  if(key==='ArrowLeft'||key==='ArrowRight')index=Math.max(0,Math.min(candles.length-1,index+(key==='ArrowLeft'?-1:1)));
  const values=candlePrices(candles[index]);
  if(!values.length)return null;
  let picked=values.find(p=>p.field==='close')||values[0];
  if((key==='ArrowUp'||key==='ArrowDown') && current?.index===index){
    const unique=values.filter((p,i)=>values.findIndex(v=>v.price===p.price)===i).sort((a,b)=>a.price-b.price);
    const position=unique.findIndex(p=>p.price===current.price);
    picked=unique[Math.max(0,Math.min(unique.length-1,position+(key==='ArrowUp'?1:-1)))];
  }
  return {...picked,index};
}
