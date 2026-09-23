/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import {useEffect, useRef, useState} from "react";
import {ReplayEventSymbol} from "./replay-event-symbol";

const CHART_TYPES = ["ENTRY","ADD","REDUCE","EXIT","MAE","MFE"];
export function ReplayEventMarkers({geometry:g,events,candles,currency,onSelect,interactive=true}: {geometry:any;events:any[];candles:any[];currency:string;onSelect:(id:string)=>void;interactive?:boolean}) {
  const ref=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState<string|null>(null);
  const groups:any[]=[];
  for(const event of [...events].sort((a,b)=>Number(["MAE","MFE"].includes(a.type))-Number(["MAE","MFE"].includes(b.type)))){
    if(!CHART_TYPES.includes(event.type) || !(event.price>0) || !event.date || event.date>candles.at(-1)?.date)continue;
    const index=candles.findIndex(c=>c.date===event.date);
    if(index<0)continue;
    const x=g.left+g.step*(index+.5), y=g.top+(g.high-event.price)/(g.high-g.low)*(g.priceBottom-g.top);
    if(y<g.top || y>g.priceBottom)continue;
    const overlap=groups.find(group=>Math.abs(group.x-x)<22 && Math.abs(group.y-y)<22);
    if(overlap)overlap.events.push(event);else groups.push({id:event.id,x,y,events:[event]});
  }
  const selected=groups.find(group=>group.id===open);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node))setOpen(null);};
    const element=ref.current;
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&open){event.stopPropagation();event.preventDefault();setOpen(null);}};
    document.addEventListener('pointerdown',outside);element?.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);element?.removeEventListener('keydown',escape);};
  },[open]);
  return <div ref={ref} className="replay-event-layer">
    {groups.map(group=><button key={group.id} type="button" tabIndex={interactive?0:-1} aria-disabled={!interactive} className={`replay-event-icon ${group.events[0].type.toLowerCase()}`} style={{left:`${group.x/g.width*100}%`,top:`${group.y/g.height*100}%`}} aria-label={group.events.map((e:any)=>`${e.label} ${e.date}`).join('、')} aria-expanded={group.id===open} onClick={()=>{setOpen(open===group.id?null:group.id);onSelect(group.events[0].id);}}><ReplayEventSymbol type={group.events[0].type}/></button>)}
    {selected&&<section className="replay-event-popover" aria-label="交易標記資訊" style={{left:`clamp(0px, ${selected.x/g.width*100}% - 130px, max(0px, 100% - 270px))`,top:`${Math.max(0,Math.min(g.height-190,selected.y+18))/g.height*100}%`}}><button type="button" className="marker-close" aria-label="關閉標記資訊" onClick={()=>setOpen(null)}>×</button>{selected.events.map((event:any)=><div className="marker-event-detail" key={event.id}><b><ReplayEventSymbol type={event.type}/>{event.label}</b><small>{event.date}</small><strong>{currency} {Number(event.price).toLocaleString('zh-TW',{maximumFractionDigits:4})}</strong>{event.quantity>0&&<span>數量 {event.quantity.toLocaleString('zh-TW')} 股</span>}<p>{event.detail}</p></div>)}</section>}
  </div>;
}
