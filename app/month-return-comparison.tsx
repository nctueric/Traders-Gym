"use client";
import {useValuation} from './valuation-context';
import {currencyTotal} from '@/lib/valuation.mjs';
import {periodValuation,historicalMonths} from '@/lib/valuation-reports.mjs';
import {InfoPopover} from "./info-popover";
import {snapshotMonthComparisons} from '@/lib/snapshot-performance.mjs';
import {useEffect,useMemo,useRef,useState} from 'react';
const pct=(v:number|null)=>v==null?'—':`${v>=0?'+':''}${(v*100).toFixed(1)}%`;
export function MonthReturnComparison({data,equity}:{data:object;equity:{assetByCurrency?:Record<string,number>;asOf:string;totalUsd:number|null;unpricedPositionCount?:number};fx:number|null;fetcher:typeof fetch}) {
 const valuation=useValuation();
 const host=useRef<HTMLElement>(null);const [width,setWidth]=useState(300);
 useEffect(()=>{if(!host.current)return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(1,entry.contentRect.width)));observer.observe(host.current);return()=>observer.disconnect();},[]);
 const [hint,setHint]=useState<string|null>(null);
 const points=useMemo(()=>{const now=new Date(equity.asOf),current=currencyTotal(equity.assetByCurrency||{},valuation.currency,valuation.rate),fallback=snapshotMonthComparisons(data,now,valuation.currency,valuation.rate);const months=historicalMonths(data,valuation.history?.cache,now,valuation.currency,{total:current}),byMonth=new Map(months.map(m=>[m.month,m]));const selected:Array<{month:string;partial?:boolean;portfolio?:number|null;profit?:number|null;benchmark?:number|null;benchmarkDate?:string}>=fallback.length?fallback:months.slice(-3).map(m=>({month:m.month,partial:m.isCurrent}));return selected.slice(-3).map(f=>{const m=byMonth.get(f.month),isCurrent=f.month===now.toISOString().slice(0,7),p=isCurrent?periodValuation(data,valuation.history?.cache,now,valuation.currency,current,'month'):null;return {month:f.month,portfolio:p?.rate??m?.return??f.portfolio??null,profitUsd:p?.profit??m?.change??f.profit??null,problems:p?.problems||m?.problems||[],benchmark:{rate:m?.benchmark??f.benchmark??null,date:isCurrent?valuation.history?.cache?.entries?.['QQQ:adjusted']?.bars?.at(-1)?.date||f.benchmarkDate:f.benchmarkDate||f.month},partial:f.partial??isCurrent};});},[data,equity,valuation]);
 const status=valuation.history?'':'歷史行情載入中';
 const values=points.flatMap(p=>[p.portfolio,p.benchmark.rate]).filter((v):v is number=>v!=null&&Number.isFinite(v));
 const low=Math.min(0,...values),high=Math.max(.01,...values),pad=(high-low)*.18;
 const min=low<0?low-pad:0,max=high+pad,y=(v:number)=>22+(max-v)/(max-min)*90;
 return <section ref={host} className="month-comparison" aria-label="投資組合與 QQQ 月報酬比較"><svg viewBox={`0 0 ${width} 150`} role="group" onPointerLeave={()=>setHint(null)} onKeyDown={event=>{if(event.key==='Escape')setHint(null);}} aria-label="最近三個月報酬，藍色投資組合、青色 QQQ">
 {[min,0,max].filter((v,i,a)=>a.indexOf(v)===i).map(v=><g key={v}><line x1="12" x2={width-12} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={v===0?1.5:0.7}/></g>)}
 {points.map((p,i)=><g key={p.month}>{[p.portfolio,p.benchmark.rate].map((v,j)=>{const count=Math.max(points.length,1),center=12+(width-24)*(i+.5)/count;const barWidth=Math.min(27,(width-24)/(count*4));const x=center+(j===0?-barWidth-3:3);const label=`${p.month} ${j?'QQQ':'投資組合'}：${pct(v)}${j?`，報價日 ${p.benchmark.date||'缺資料'}`:`，損益 ${valuation.currency} ${p.profitUsd?.toFixed(1)??'—'}`}`;return <g key={j} tabIndex={0} aria-label={label} onPointerEnter={()=>setHint(label)} onFocus={()=>setHint(label)} onBlur={()=>setHint(null)} onClick={()=>setHint(label)}><rect x={x-3} y="15" width={barWidth+6} height="108" fill="transparent"/>{v!=null?<><rect x={x} y={Math.min(y(0),y(v))} width={barWidth} height={Math.max(1,Math.abs(y(v)-y(0)))} fill={j?'#29aebe':'#4285ed'}/></>:<text x={x+barWidth/2} y={y(0)-5} textAnchor="middle">—</text>}</g>;})}<text x={12+(width-24)*(i+.5)/Math.max(points.length,1)} y="137" textAnchor="middle">{Number(p.month.slice(5))}月{p.partial?'至今':''}</text></g>)}
 </svg>{hint&&<div className="month-comparison-tooltip" role="status">{hint}</div>}<div className="month-comparison-legend"><span><i className="portfolio-swatch"/>組合</span><span><i className="qqq-swatch"/>QQQ</span><InfoPopover label="QQQ 比較"><p>最近三個月；投資組合採所選幣別及各日真實匯率。QQQ 採調整後收盤價，同樣換算至所選幣別；與投資組合即時估值可能有時間差。</p>{points.map(p=><p key={p.month}>{p.month}：QQQ 報價日 {p.benchmark.date||'缺資料'}。{p.problems.join('；')}</p>)}</InfoPopover></div>{status&&<small role="status">{status}</small>}</section>;
}
