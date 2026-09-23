/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import {useRef,useState} from 'react';
import {keyboardRulerPoint,PRICE_LABELS,rulerResult,snapRulerPoint} from '@/lib/price-ruler.mjs';
const priceText=(value:number)=>value.toLocaleString('zh-TW',{maximumFractionDigits:4});
const signed=(value:number,places:number)=>`${value>0?'+':value<0?'−':''}${Math.abs(value).toLocaleString('zh-TW',{maximumFractionDigits:places,minimumFractionDigits:places===2?2:0})}`;
export function PriceRuler({geometry:g,candles,currency,onInspect,onExit}:{geometry:any;candles:any[];currency:string;onInspect:(index:number|null)=>void;onExit:()=>void}) {
  const [base,setBase]=useState<any>(null),[target,setTarget]=useState<any>(null),[candidate,setCandidate]=useState<any>(null);
  const gesture=useRef<{x:number;y:number;moved:boolean}|null>(null);
  const pointFor=(event:React.PointerEvent<SVGSVGElement>)=>{
    const rect=event.currentTarget.getBoundingClientRect();
    return snapRulerPoint(g,candles,(event.clientX-rect.left)*g.width/rect.width,(event.clientY-rect.top)*g.height/rect.height);
  };
  const choose=(point:any)=>{if(!point)return;setCandidate(point);onInspect(point.index);if(!base||target){setBase(point);setTarget(null);}else setTarget(point);};
  const preview=(point:any)=>{setCandidate(point);onInspect(point?.index??null);};
  const xy=(point:any)=>({x:g.left+g.step*(candles.findIndex((c:any)=>c.date===point.date)+.5),y:g.top+(g.high-point.price)/(g.high-g.low)*(g.priceBottom-g.top)});
  const relative=target||candidate, result=rulerResult(base,relative);
  const a=base?xy(base):null,b=relative?xy(relative):null;
  const heading=target?'量測結果':base?'預覽・點擊固定相對點':'點擊建立基準點';
  return <div className="price-ruler" tabIndex={0} role="slider" aria-label="價格量尺，左右選 K 棒，上下選價格，Enter 確認，Escape 退出" aria-valuemin={1} aria-valuemax={candles.length} aria-valuenow={(candidate?.index??candles.length-1)+1} aria-valuetext={candidate?`${candidate.date} ${PRICE_LABELS[candidate.field as keyof typeof PRICE_LABELS]} ${candidate.price}`:'尚未選點'} onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onInspect(null);onExit();return;}
    if(event.key.startsWith('Arrow')){event.preventDefault();preview(keyboardRulerPoint(candles,candidate,event.key));}
    if(event.key==='Enter'){event.preventDefault();choose(candidate||keyboardRulerPoint(candles,null,'initial'));}
  }}>
    <svg viewBox={`0 0 ${g.width} ${g.height}`} preserveAspectRatio="none" aria-hidden="true" onPointerDown={event=>{if(!event.isPrimary||event.button!==0)return;gesture.current={x:event.clientX,y:event.clientY,moved:false};event.currentTarget.parentElement?.focus({preventScroll:true});}} onPointerMove={event=>{
      if(gesture.current&&Math.hypot(event.clientX-gesture.current.x,event.clientY-gesture.current.y)>8)gesture.current.moved=true;
      if(event.pointerType!=='touch')preview(pointFor(event));
    }} onPointerUp={event=>{const down=gesture.current;gesture.current=null;if(down&&!down.moved&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<=8)choose(pointFor(event));}} onPointerCancel={()=>{gesture.current=null;}} onPointerLeave={()=>{gesture.current=null;setCandidate(null);onInspect(null);}}>
      {a&&b&&<g className={`ruler-measure ${result&&result.difference<0?'falling':'rising'}`}><rect x={Math.min(a.x,b.x)} y={Math.min(a.y,b.y)} width={Math.max(1,Math.abs(b.x-a.x))} height={Math.max(1,Math.abs(b.y-a.y))}/><line x1={a.x} y1={a.y} x2={b.x} y2={b.y}/></g>}
      {base&&a&&<circle className="ruler-anchor" cx={a.x} cy={a.y} r={5}/>}
      {relative&&b&&<circle className="ruler-anchor" cx={b.x} cy={b.y} r={5}/>}
      {target&&candidate&&<circle className="ruler-candidate" cx={xy(candidate).x} cy={xy(candidate).y} r={4}/>}
    </svg>
    <div className="ruler-readout" role="status"><b>{heading}</b>{base&&<span>基準 {base.date}・{PRICE_LABELS[base.field as keyof typeof PRICE_LABELS]} {priceText(base.price)} {currency}</span>}{relative&&<span>{base?'相對':'吸附'} {relative.date}・{PRICE_LABELS[relative.field as keyof typeof PRICE_LABELS]} {priceText(relative.price)} {currency}</span>}{result&&<strong>價差 {signed(result.difference,4)} {currency} · {signed(result.percent,2)}%</strong>}{target&&candidate&&<small>再次點擊：{candidate.date}・{PRICE_LABELS[candidate.field as keyof typeof PRICE_LABELS]} {priceText(candidate.price)}，建立新基準</small>}</div>
  </div>;
}
