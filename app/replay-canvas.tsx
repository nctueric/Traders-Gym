/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {ReplayCrosshair} from './replay-crosshair';
import {ReplayEventMarkers} from './replay-event-markers';
import {chartPlanDate,chartPriceLines,chartPriceRange,layoutPriceLabels} from '@/lib/chart-price-labels.mjs';
import {PriceRuler} from './price-ruler';
export const EMA_STYLE: Record<number, {color:string;dash:number[]}> = {10:{color:'#368bdd',dash:[]},21:{color:'#d78a28',dash:[7,3]},50:{color:'#a478cf',dash:[2,3]}};
export function ReplayCanvas({ model, cursor, selectedEventId, enabledEma, currency, emaCandle, onInspect, onSelectMarker, rulerEnabled, rulerClear, onExitRuler }: { model: any; cursor: number; selectedEventId: string | null; enabledEma: number[]; currency: string; emaCandle: any; onInspect: (index: number | null) => void; onSelectMarker: (id:string) => void; rulerEnabled:boolean; rulerClear:number; onExitRuler:()=>void }) {
  const [showAll,setShowAll] = useState(false);
  const [history,setHistory] = useState(false);
  const [labelOpen,setLabelOpen] = useState<number|null>(null);
  const [geometry, setGeometry] = useState<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visibleCandles = useMemo(() => model.candles.slice(0, cursor + 1), [model.candles, cursor]);

  const lines=useMemo(()=>chartPriceLines(model,chartPlanDate(model,visibleCandles,selectedEventId,cursor===model.candles.length-1),selectedEventId,history),[model,visibleCandles,selectedEventId,history,cursor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visibleCandles.length) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) return;
      const styles = getComputedStyle(canvas);
      const chartText = styles.getPropertyValue("--review-chart-text").trim() || "#66716e";
      const chartLine = styles.getPropertyValue("--review-chart-line").trim() || "#e4e5dc";
      context.scale(scale, scale);
      context.clearRect(0, 0, width, height);
      const padding = { top: width < 500 ? 66 : 40, right: width < 500 ? 116 : 170, bottom: 28, left: 16 };
      const chartWidth = width - padding.left - padding.right;
      const volumeHeight = 84;
      const chartGap = 22;
      const chartHeight = height - padding.top - padding.bottom - volumeHeight - chartGap;
      const volumeTop = padding.top + chartHeight + chartGap;
      const {low,high}=chartPriceRange(visibleCandles,enabledEma,lines,showAll);
      const yFor = (price: number) => padding.top + (high - price) / (high - low) * chartHeight;
      const step = chartWidth / Math.max(visibleCandles.length, 1);
      const xFor = (index: number) => padding.left + step * (index + 0.5);

      setGeometry({width,height,left:padding.left,right:width-padding.right,top:padding.top,priceBottom:padding.top+chartHeight,volumeBottom:volumeTop+volumeHeight,low,high,step});
      context.strokeStyle = chartLine;
      context.lineWidth = 1;
      for (let row = 0; row <= 4; row += 1) {
        const y = padding.top + chartHeight * row / 4;
        context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke();
        const price = high - (high - low) * row / 4;
        context.fillStyle = chartText; context.font = "12px system-ui"; context.fillText(Number(price.toPrecision(5)).toString(), padding.left + 2, y - 4);
      }

      // Place month dividers between adjacent candle centers, behind prices and volume.
      context.save(); context.strokeStyle = chartText; context.globalAlpha = 0.4;
      context.lineWidth = 1; context.setLineDash([1, 4]);
      visibleCandles.forEach((candle: any, index: number) => {
        if (index === 0 || candle.date.slice(0, 7) === visibleCandles[index - 1].date.slice(0, 7)) return;
        const x = (xFor(index - 1) + xFor(index)) / 2;
        context.beginPath(); context.moveTo(x, padding.top); context.lineTo(x, volumeTop + volumeHeight); context.stroke();
      });
      context.restore();

      visibleCandles.forEach((candle: any, index: number) => {
        const x = xFor(index);
        const rising = candle.close >= candle.open;
        context.strokeStyle = rising ? "#176b50" : "#a8463b";
        context.fillStyle = rising ? "#70a58c" : "#d58b83";
        context.beginPath(); context.moveTo(x, yFor(candle.high)); context.lineTo(x, yFor(candle.low)); context.stroke();
        const top = yFor(Math.max(candle.open, candle.close));
        const bodyHeight = Math.max(2, Math.abs(yFor(candle.open) - yFor(candle.close)));
        const bodyWidth = Math.max(2, Math.min(8, step * 0.56));
        context.fillRect(x - bodyWidth / 2, top, bodyWidth, bodyHeight);
      });

      const volumes = visibleCandles.map((candle: any) => Number(candle.volume) || 0);
      const volumeAverages = visibleCandles.map((candle: any) => Number(candle.averageVolume20) || 0);
      const maximumVolume = Math.max(...volumes, ...volumeAverages, 1);
      const volumeY = (value: number) => volumeTop + volumeHeight - value / maximumVolume * volumeHeight;
      context.strokeStyle = chartLine;
      context.beginPath(); context.moveTo(padding.left, volumeTop); context.lineTo(width - padding.right, volumeTop); context.stroke();
      context.fillStyle = chartText; context.font = "12px system-ui"; context.fillText("成交量", padding.left, volumeTop - 6);
      visibleCandles.forEach((candle: any, index: number) => {
        if (candle.volume == null || candle.volume < 0) return;
        const x = xFor(index);
        const rising = candle.close >= candle.open;
        const barWidth = Math.max(2, Math.min(8, step * 0.62));
        context.fillStyle = rising ? "#78aa92aa" : "#d48b83aa";
        context.fillRect(x - barWidth / 2, volumeY(candle.volume), barWidth, Math.max(1, volumeTop + volumeHeight - volumeY(candle.volume)));
      });
      context.save(); context.strokeStyle = "#d68b32"; context.lineWidth = 1.4; context.beginPath();
      let averageStarted = false;
      visibleCandles.forEach((candle: any, index: number) => {
        if (!(candle.averageVolume20 > 0)) return;
        const x = xFor(index); const y = volumeY(candle.averageVolume20);
        if (!averageStarted) { context.moveTo(x, y); averageStarted = true; } else context.lineTo(x, y);
      });
      if (averageStarted) context.stroke(); context.restore();

      const g={top:padding.top,priceBottom:padding.top+chartHeight,low,high};
      for(const line of lines.flatMap((group:any)=>group.details)) {
        const y=yFor(line.price);if(y<g.top||y>g.priceBottom)continue;
        const start=line.date?visibleCandles.findIndex((c:any)=>c.date>=line.date):0;
        if(start<0)continue;
        const finish=line.endDate?visibleCandles.findIndex((c:any)=>c.date>=line.endDate):-1;
        context.save();context.strokeStyle=line.color;context.lineWidth=1;context.setLineDash(line.dash||[6,4]);context.beginPath();context.moveTo(line.date?xFor(start):padding.left,y);context.lineTo(finish>=0?xFor(finish):width-padding.right,y);context.stroke();context.restore();
      }
      for(const line of layoutPriceLabels(lines,g)) {
        context.save();context.strokeStyle=line.color;context.lineWidth=1;context.beginPath();context.moveTo(width-padding.right-6,line.actualY);context.lineTo(width-padding.right+8,line.y);context.stroke();context.restore();
      }
      for (const period of enabledEma) {
        context.save(); context.strokeStyle = EMA_STYLE[period].color; context.lineWidth = 1.5; context.setLineDash(EMA_STYLE[period].dash); context.beginPath();
        let started = false;
        visibleCandles.forEach((candle: any, index: number) => {
          const value = candle.ema?.[period];
          if (value == null) { started = false; return; }
          if (!started) context.moveTo(xFor(index), yFor(value)); else context.lineTo(xFor(index), yFor(value));
          started = true;
        });
        context.stroke(); context.restore();
      }

      context.fillStyle = chartText; context.font = "12px system-ui";
      const labelIndexes = [...new Set([0, Math.floor((visibleCandles.length - 1) / 2), visibleCandles.length - 1])];
      labelIndexes.forEach((index) => { const label = visibleCandles[index]?.date || ""; context.fillText(label.slice(5), Math.max(0, xFor(index) - 14), height - 10); });
      context.save(); context.strokeStyle = "#17211f33"; context.setLineDash([3, 4]); context.beginPath(); context.moveTo(xFor(visibleCandles.length - 1), padding.top); context.lineTo(xFor(visibleCandles.length - 1), volumeTop + volumeHeight); context.stroke(); context.restore();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [model, visibleCandles, enabledEma, lines, showAll]);

  return <><div className="chart-price-controls"><button type="button" aria-pressed={showAll} onClick={()=>setShowAll(!showAll)}>顯示全部價位</button>{model.events?.some((e:any)=>["PLAN_STOP","PLAN_TARGET"].includes(e.type))&&<button type="button" aria-pressed={history} onClick={()=>setHistory(!history)}>歷史計畫</button>}</div><div className={`replay-canvas-stack ${rulerEnabled ? "is-measuring" : ""}`}><canvas ref={canvasRef} className="replay-canvas" role="img" aria-label={model.chartLabel || `${model.symbol} 進場前三個月到出場後三個月的日線交易決策重播；包含成交量、成交、計畫、MAE及MFE`}>交易決策重播圖</canvas><div className="ema-chart-values" aria-label="目前 K 棒均線">{enabledEma.map(period => <span key={period} style={{color:EMA_STYLE[period].color}}>EMA {period}：{emaCandle?.ema?.[period] == null ? "—" : emaCandle.ema[period].toFixed(2)}</span>)}</div>{geometry&&<div className="chart-price-labels">{layoutPriceLabels(lines,geometry).map((line:any,i:number)=><button type="button" key={line.price} className="chart-price-label" style={{top:line.y,left:geometry.right+10,color:line.color}} aria-expanded={labelOpen===i} aria-label={`${line.label} ${currency} ${line.price}${line.edge?'，超出圖表範圍':''}`} onFocus={()=>setLabelOpen(i)} onBlur={()=>setLabelOpen(null)} onClick={()=>setLabelOpen(i)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setLabelOpen(null);}}}><span>{line.edge==='above'?'↑ ':line.edge==='below'?'↓ ':''}<span className="price-label-full">{line.label}</span><span className="price-label-short">{line.details.length>1?'價位 '+line.details.length:line.label.includes('草稿')?'草稿':line.label.includes('均價')?'均價':line.label.includes('停利')?'停利':'停損'}</span></span><b>{Number(line.price.toPrecision(6))}</b>{labelOpen===i&&<span className="chart-price-detail" style={line.y<120?{bottom:'auto',top:22}:undefined}>{line.details.map((d:any,j:number)=><span key={j}>{d.label}・{currency} {d.price}・{d.source || '目前計畫'}・{d.timestamp || d.date || '目前預覽'}</span>)}</span>}</button>)}</div>}{geometry && !rulerEnabled && <ReplayCrosshair geometry={geometry} candles={visibleCandles} currency={currency} onInspect={onInspect}/>}{geometry && <ReplayEventMarkers key={rulerEnabled ? "measure" : "inspect"} interactive={!rulerEnabled} geometry={geometry} events={model.events} candles={visibleCandles} currency={currency} onSelect={onSelectMarker}/>}{geometry && rulerEnabled && <PriceRuler key={rulerClear} geometry={geometry} candles={visibleCandles} currency={currency} onInspect={onInspect} onExit={onExitRuler}/>}</div></>;
}

