"use client";
import {convertCurrency} from '@/lib/valuation.mjs';
import {useValuation} from './valuation-context';
import { useEffect, useRef, useState } from 'react';
import { heatmapItems, heatmapColor, layoutHoldings, normalizeHoldingsColorScheme } from '@/lib/holdings-heatmap.mjs';
type Position = { id:string; symbol:string; direction:string; quantity:number; accountId?:string;currency?:string };
type Row = { position:Position; metrics:{marketValueUsd:number|null;marketValue?:number|null}; quote?:{price:number;previousClose:number|null;updatedAt:string|null}|null };
const percent=(v:number|null)=>v==null?'缺當日報價':`${v>=0?'+':''}${(v*100).toFixed(1)}%`;
export function HoldingsHeatmap({rows,onOpenChart,colorScheme}:{rows:Row[];colorScheme?:string;onOpenChart:(p:Position)=>void}) {
 const valuation=useValuation(),money=valuation.format;
 const host=useRef<HTMLDivElement>(null);const [width,setWidth]=useState(640);
 useEffect(()=>{if(!host.current)return;const observer=new ResizeObserver(([e])=>setWidth(Math.max(1,e.contentRect.width)));observer.observe(host.current);return()=>observer.disconnect();},[]);
 const height=140,items=heatmapItems(rows).map((item:{value:number|null},i:number)=>({...item,value:convertCurrency(rows[i].metrics.marketValue??null,rows[i].position.currency||'USD',valuation.currency,valuation.rate)})),tiles=layoutHoldings(items,width,height),missing=items.length-tiles.length;
 const total=tiles.reduce((s,t)=>s+t.value,0);
 return <section className="holdings-heatmap" aria-label="持倉熱力圖"><header><h3>持倉熱力圖</h3><small>面積：部位金額・顏色：當日損益率</small></header><div ref={host} className="holdings-map" style={{height}}>{tiles.length?tiles.map(tile=>{
 const label=`${tile.position.symbol}・${tile.position.direction==='SHORT'?'空':'多'}・${tile.position.accountId||''}，${money(tile.value)}，占可估值持倉 ${(tile.value/total*100).toFixed(1)}%，當日 ${percent(tile.rate)}${tile.updatedAt?`，報價 ${tile.updatedAt}`:''}`;
 return <button key={tile.id} type="button" className="holdings-tile" aria-label={`${label}，開啟 K 線`} title={label} onClick={()=>onOpenChart(tile.position)} style={{left:`${tile.x/width*100}%`,top:tile.y,width:`${tile.width/width*100}%`,height:tile.height,background:heatmapColor(tile.rate,colorScheme)}}>{tile.width>=48&&tile.height>=24&&<b>{tile.position.symbol}{tile.position.direction==='SHORT'?' 空':''}</b>}{tile.width>=65&&tile.height>=48&&<span>{percent(tile.rate)}</span>}</button>;
 }):<div className="holdings-map-empty">{rows.length?'缺少行情或匯率，暫無可估值持倉':'目前沒有持倉'}</div>}</div><div className="holdings-map-legend"><span>{normalizeHoldingsColorScheme(colorScheme)==="green-up"?"綠":"紅"}：獲利</span><span>{normalizeHoldingsColorScheme(colorScheme)==="green-up"?"紅":"綠"}：虧損</span><span>灰：持平／缺資料</span><small>顏色越深，幅度越大</small></div>{missing>0&&<small className="muted">{missing} 個部位缺估值，未納入面積。</small>}</section>;
}
