"use client";
import {InfoPopover} from "./info-popover";
import {useEffect,useMemo,useRef,useState} from 'react';
import {buildMonthComparison} from '@/lib/month-return-comparison.mjs';
const pct=(v:number|null)=>v==null?'—':`${v>=0?'+':''}${(v*100).toFixed(1)}%`;
export function MonthReturnComparison({data,equity,fx,fetcher}:{data:object;equity:{asOf:string;totalUsd:number|null;unpricedPositionCount?:number};fx:number|null;fetcher:typeof fetch}) {
 const host=useRef<HTMLElement>(null);const [width,setWidth]=useState(300);
 useEffect(()=>{if(!host.current)return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(1,entry.contentRect.width)));observer.observe(host.current);return()=>observer.disconnect();},[]);
 const [hint,setHint]=useState<string|null>(null);
 const [bars,setBars]=useState<{date:string;close:number}[]>([]),[status,setStatus]=useState('QQQ 讀取中');
 useEffect(()=>{const controller=new AbortController();fetcher('/api/history?symbol=QQQ',{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error();return r.json();}).then(p=>{if(!controller.signal.aborted){setBars(p.bars||[]);setStatus('');}}).catch(()=>{if(!controller.signal.aborted)setStatus('QQQ 行情暫時無法取得');});return()=>controller.abort();},[fetcher]);
 const points=useMemo(()=>buildMonthComparison(data,equity,fx,bars),[data,equity,fx,bars]);
 const values=points.flatMap(p=>[p.portfolio,p.benchmark.rate]).filter((v):v is number=>v!=null&&Number.isFinite(v));
 const low=Math.min(0,...values),high=Math.max(.01,...values),pad=(high-low)*.18;
 const min=low<0?low-pad:0,max=high+pad,y=(v:number)=>22+(max-v)/(max-min)*90;
 return <section ref={host} className="month-comparison" aria-label="投資組合與 QQQ 月報酬比較"><svg viewBox={`0 0 ${width} 150`} role="group" onPointerLeave={()=>setHint(null)} onKeyDown={event=>{if(event.key==='Escape')setHint(null);}} aria-label="最近兩月報酬，藍色投資組合、青色 QQQ">
 {[min,0,max].filter((v,i,a)=>a.indexOf(v)===i).map(v=><g key={v}><line x1="12" x2={width-12} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={v===0?1.5:0.7}/></g>)}
 {points.map((p,i)=><g key={p.month}>{[p.portfolio,p.benchmark.rate].map((v,j)=>{const center=12+(width-24)*(i+.5)/2;const barWidth=Math.min(27,(width-24)/8);const x=center+(j===0?-barWidth-3:3);const label=`${p.month} ${j?'QQQ':'投資組合'}：${pct(v)}${j?`，報價日 ${p.benchmark.date||'缺資料'}`:`，損益 USD ${p.profitUsd?.toFixed(1)??'—'}`}`;return <g key={j} tabIndex={0} aria-label={label} onPointerEnter={()=>setHint(label)} onFocus={()=>setHint(label)} onBlur={()=>setHint(null)} onClick={()=>setHint(label)}><rect x={x-3} y="15" width={barWidth+6} height="108" fill="transparent"/>{v!=null?<><rect x={x} y={Math.min(y(0),y(v))} width={barWidth} height={Math.max(1,Math.abs(y(v)-y(0)))} fill={j?'#29aebe':'#4285ed'}/></>:<text x={x+barWidth/2} y={y(0)-5} textAnchor="middle">—</text>}</g>;})}<text x={12+(width-24)*(i+.5)/2} y="137" textAnchor="middle">{Number(p.month.slice(5))}月{p.partial?'至今':''}</text></g>)}
 </svg>{hint&&<div className="month-comparison-tooltip" role="status">{hint}</div>}<div className="month-comparison-legend"><span><i className="portfolio-swatch"/>組合</span><span><i className="qqq-swatch"/>QQQ</span><InfoPopover label="QQQ 比較"><p>最近兩月；投資組合沿用當月 Modified Dietz 估算及目前匯率。QQQ 為月初前最後收盤至當月最新可用收盤的價格報酬，不含股息；與投資組合即時估值可能有時間差。</p>{points.map(p=><p key={p.month}>{p.month}：QQQ 報價日 {p.benchmark.date||'缺資料'}。{p.problems.join('；')}</p>)}</InfoPopover></div>{status&&<small role="status">{status}</small>}</section>;
}
