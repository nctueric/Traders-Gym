/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { themedContext, observeChartTheme } from "./chart-theme";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ASSET_SEGMENTS, buildMonthlyAssetHistory, buildMonthlyAssetPoint, monthlyAssetSegments, withMonthlyChanges } from "@/lib/monthly-assets.mjs";

const money = (value: number | null) => value == null ? "—" : new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",currencyDisplay:"code",maximumFractionDigits:2}).format(value);
const wholeAmount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const chartTotal = (value: number | null) => value == null ? "—" : wholeAmount.format(Math.abs(value) < .5 ? 0 : value);
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Reserve a full label's width per month; narrow screens scroll without shrinking the text.
const chartMinWidth = (points: any[]) => Math.max(600, points.length * Math.max(68, ...points.map(point => chartTotal(point.totalUsd).length * 8 + 16)) + 102);
// Keep the existing half-slot bar; reduce the other half (the gap) to 20%.
const compactChartWidth = (originalWidth: number) => 102 + (originalWidth - 102) * .6;

export function MonthlyAssetChart({ points, selectedMonth, onSelect }: {points:any[];selectedMonth:string;onSelect:(month:string)=>void}) {
  const canvasRef=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const canvas=canvasRef.current;
    if (!canvas) return;
    const draw=()=>{
      // The outer viewport stays stable when the inner chart becomes narrower.
      const originalWidth=Math.max(chartMinWidth(points),canvas.parentElement?.parentElement?.clientWidth || 0);
      const width=compactChartWidth(originalWidth),height=360;
      const scale=window.devicePixelRatio || 1;
      canvas.style.width=`${width}px`;
      canvas.style.height=`${height}px`;
      canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
      const ctx=themedContext(canvas);if(!ctx)return;
      ctx.scale(scale,scale);ctx.clearRect(0,0,width,height);
      const values=points.flatMap(point=>monthlyAssetSegments(point).flatMap((segment:any)=>[segment.from,segment.to]));
      const low=Math.min(0,...values), high=Math.max(1,...values), range=high-low || 1;
      const min=low-range*.05,max=high+range*.1,pad={left:82,right:20,top:20,bottom:55};
      const plotHeight=height-pad.top-pad.bottom;
      const y=(value:number)=>pad.top+(max-value)/(max-min)*plotHeight;
      const originalStep=(originalWidth-pad.left-pad.right)/Math.max(1,points.length);
      const step=originalStep*.6,barWidth=originalStep*.5;
      ctx.font='12px system-ui, "PingFang TC", sans-serif';
      ctx.textAlign="right";ctx.fillStyle="#53645c";
      for(let index=0;index<=4;index++){
        const value=min+(max-min)*index/4,py=y(value);
        ctx.strokeStyle="#d8e0db";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.left,py);ctx.lineTo(width-pad.right,py);ctx.stroke();
        ctx.fillText(new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1}).format(value),pad.left-10,py+4);
      }
      ctx.fillText("USD",pad.left-10,12);
      ctx.strokeStyle="#53645c";ctx.beginPath();ctx.moveTo(pad.left,y(0));ctx.lineTo(width-pad.right,y(0));ctx.stroke();
      points.forEach((point,index)=>{
        const x=pad.left+step*(index+.5),segments=monthlyAssetSegments(point);
        if(point.month===selectedMonth){ctx.fillStyle="#176b500c";ctx.fillRect(x-step/2,pad.top,step,plotHeight);}
        if(!segments.length){ctx.textAlign="center";ctx.fillStyle="#53645c";ctx.fillText("缺資料",x,y(0)-10);}
        for(const segment of segments){
          if(Math.abs(segment.value)<.00001)continue;
          const top=Math.min(y(segment.from),y(segment.to)),size=Math.max(1,Math.abs(y(segment.from)-y(segment.to)));
          ctx.fillStyle=segment.color;ctx.fillRect(x-barWidth/2,top,barWidth,size);
          ctx.strokeStyle="#53645c";ctx.lineWidth=.75;ctx.strokeRect(x-barWidth/2,top,barWidth,size);
          if(segment.value<0 && size>18){ctx.fillStyle="#17211f";ctx.textAlign="center";ctx.fillText("↓",x,top+Math.min(size/2+4,18));}
        }
        ctx.fillStyle=point.month===selectedMonth?"#176b50":"#41564a";ctx.textAlign="center";
        const monthIndex=Number(point.month.slice(5,7))-1;
        ctx.fillText(monthNames[monthIndex],x,height-28);
        if(monthIndex===0)ctx.fillText(point.month.slice(0,4),x,height-10);
      });
      // Draw totals last so adjoining bars cannot paint over the labels.
      const placedLabels: {left:number;right:number;top:number;bottom:number}[]=[];
      points.forEach((point,index)=>{
        if(!monthlyAssetSegments(point).length)return;
        const x=pad.left+step*(index+.5),label=chartTotal(point.totalUsd),anchorY=y(point.totalUsd)-7;
        const halfWidth=ctx.measureText(label).width/2+4;
        let labelY=anchorY;
        // Keep full integer amounts legible when neighboring months are closer.
        for(let attempt=0;attempt<32;attempt++){
          const offset=attempt===0?0:Math.ceil(attempt/2)*18*(attempt%2?-1:1);
          const candidate=anchorY+offset;
          if(candidate<16 || candidate>height-pad.bottom-4)continue;
          if(placedLabels.some(box=>x-halfWidth<box.right && x+halfWidth>box.left && candidate-12<box.bottom && candidate+4>box.top))continue;
          labelY=candidate;break;
        }
        placedLabels.push({left:x-halfWidth,right:x+halfWidth,top:labelY-12,bottom:labelY+4});
        ctx.textAlign="center";ctx.strokeStyle="#ffffff";ctx.lineWidth=4;ctx.lineJoin="round";
        ctx.strokeText(label,x,labelY);
        ctx.fillStyle="#17211f";ctx.fillText(label,x,labelY);
      });
    };
    draw();const observer=new ResizeObserver(draw);if(canvas.parentElement?.parentElement)observer.observe(canvas.parentElement.parentElement);
    const themeObserver = observeChartTheme(draw);
    return () => { observer.disconnect(); themeObserver.disconnect(); };
  },[points,selectedMonth]);
  return <div className="monthly-assets-chart" role="region" tabIndex={0} aria-label="逐月總資產圖，可橫向捲動">
    <div className="monthly-assets-canvas" style={{width:`max(${compactChartWidth(chartMinWidth(points))}px, calc(60% + 40.8px))`}}>
      <canvas ref={canvasRef} role="img" aria-label="逐月總資產增減堆疊圖，總資產數字四捨五入至整數美元；完整金額可在月份明細與下方資料表查看">請使用月份選單及下方資料表查看各月資產。</canvas>
      <div className="monthly-assets-hit-columns" style={{gridTemplateColumns:`repeat(${points.length},minmax(0,1fr))`}}>{points.map(point=><button key={point.month} type="button" aria-label={`${point.month} 總資產 ${money(point.totalUsd)}，查看明細`} title={`${point.month}：${money(point.totalUsd)}`} aria-pressed={point.month===selectedMonth} onClick={()=>onSelect(point.month)}><span className="sr-only">{point.month}</span></button>)}</div>
    </div>
  </div>;
}

export const MonthlyAssets = memo(function MonthlyAssets({ data, quotes, fxRate, asOf }: {data:any;quotes:Record<string,any>;fxRate:number|null;asOf:string}) {
  const [range,setRange]=useState("12"),[selection,setSelection]=useState("");
  const month=asOf.slice(0,7);
  const source=useMemo(()=>({fills:data.fills,cashActivities:data.cashActivities || [],marketBars:data.marketBars}),[data.fills,data.cashActivities,data.marketBars]);
  const history=useMemo(()=>buildMonthlyAssetHistory(source,fxRate,new Date(`${month}-15T00:00:00Z`)),[source,fxRate,month]);
  const points=useMemo(()=>!source.fills.length&&!source.cashActivities.length?[]:withMonthlyChanges([...history,buildMonthlyAssetPoint(source,month,fxRate,quotes,new Date(asOf))]),[source,history,month,fxRate,quotes,asOf]);
  const visible=useMemo(()=>range==="all"?points:points.slice(-Number(range)),[points,range]);
  const selected=visible.find((point:any)=>point.month===selection)||visible.at(-1);
  const usesTwd=[...source.fills,...source.cashActivities].some((item:any)=>item.currency==="TWD");
  return <section className="panel monthly-assets-panel" aria-label="逐月總資產變化">
    <div className="panel-head"><div><h3>逐月總資產變化</h3><p>深色已實現＋淺色未實現＝總損益；入金、出金另列，不重複加總。</p></div>
      <label className="monthly-assets-range">顯示區間<select value={range} onChange={event=>setRange(event.target.value)}><option value="12">最近12個月</option><option value="24">最近24個月</option><option value="all">全部月份</option></select></label>
    </div>
    <div className="monthly-assets-legend">{ASSET_SEGMENTS.map(segment=><span key={segment.key}><i style={{background:segment.color}}/>{segment.label}</span>)}</div>
    <p className="monthly-assets-note">數字為月末總資產，四捨五入至整數美元；本月為迄今資產、持續更新。黃色入金、紅色出金；出金與虧損向下扣減，損益為負時用深／淺紅色。</p>
    {selected ? <>
      <MonthlyAssetChart points={visible} selectedMonth={selected.month} onSelect={setSelection}/>
      <div className="monthly-assets-detail">
        <label>月份明細<select value={selected.month} onChange={event=>setSelection(event.target.value)}>{visible.map((point:any)=><option key={point.month} value={point.month}>{point.month}{point.isCurrent?"（本月迄今）":""}</option>)}</select></label>
        <dl>{[["總資產",selected.totalUsd],["較上月變化",selected.changeUsd],["總損益（累計）",selected.pnlUsd],["已實現（已閉環累計）",selected.realizedUsd],["未實現",selected.unrealizedUsd],["本月入金",selected.depositUsd],["本月出金／校正",selected.withdrawalUsd]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{money(value as number|null)}</dd></div>)}</dl>
      </div>
      {(selected.problems.length>0 || selected.estimatedSymbols.length>0 || selected.staleSymbols.length>0) && <p className="monthly-assets-warning" role="status">{selected.problems.join("；")}{selected.estimatedSymbols.length>0?`・${selected.estimatedSymbols.join("、")} 缺歷史收盤價，沿用成交價估值`:""}{selected.staleSymbols.length>0?`・${selected.staleSymbols.join("、")} 行情距月底超過7日`:""}</p>}
      <details className="monthly-assets-evidence"><summary>{selected.month} 入金／出金原始紀錄（{selected.flows.length}筆）</summary>{selected.flows.length?<div className="table-wrap" tabIndex={0} role="region" aria-label="當月資金紀錄"><table><thead><tr><th>日期（UTC）</th><th>類型</th><th>原幣金額</th><th>備註／來源ID</th></tr></thead><tbody>{selected.flows.map((flow:any)=><tr key={flow.id}><td>{flow.date}</td><td>{String(flow.type).toUpperCase()==="DEPOSIT"?"入金":"出金／現金校正"}</td><td>{flow.amount.toLocaleString("zh-TW")} {flow.currency || "幣別待確認"}</td><td className="asset-flow-note">{flow.note||"—"}<small className="block">{flow.id}</small></td></tr>)}</tbody></table></div>:<p>本月無入金／出金紀錄；期初餘額不視為本月新入金。</p>}</details>
      <details className="monthly-assets-evidence"><summary>全部月份數據與估值狀態</summary><div className="table-wrap" tabIndex={0} role="region" aria-label="逐月資產數據"><table><thead><tr>{["月份","總資產","較上月","本金／其他帳務淨額","已實現（累計）","未實現","總損益","本月入金","本月出金／校正","估值狀態"].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{points.map((point:any)=><tr key={point.month}><td><button type="button" className="text-button" onClick={()=>{setRange("all");setSelection(point.month);}}>{point.month}</button></td>{[point.totalUsd,point.changeUsd,point.baseUsd,point.realizedUsd,point.unrealizedUsd,point.pnlUsd,point.depositUsd,point.withdrawalUsd].map((value,index)=><td key={index}>{money(value)}</td>)}<td>{point.problems.join("；")||(point.estimatedSymbols.length?"成交價估值":point.staleSymbols.length?"行情較舊":point.isCurrent?"本月迄今":"月末估值")}</td></tr>)}</tbody></table></div></details>
    </>:<p className="empty">尚無交易或資金活動，可在匯入紀錄後查看逐月資產。</p>}
    <p className="monthly-assets-note">按帳本 UTC 月份分組，歷史僅用當月及以前行情。{usesTwd?`所有月份統一按本次 USDTWD ${fxRate?.toFixed(4)||"待更新"} 換算美元等值，不代表歷史匯兌報酬。`:"金額為美元等值。"} 本金／其他帳務淨額＝總資產－總損益－本月淨入金，包含以前月份資金、期初校正、未閉環部分出場及其他費用；不將此差額宣稱為交易獲利。</p>
  </section>;
});
