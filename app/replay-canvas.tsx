/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {ReplayCrosshair} from './replay-crosshair';
import {ReplayEventMarkers} from './replay-event-markers';
import {PriceRuler} from './price-ruler';
export const EMA_STYLE: Record<number, {color:string;dash:number[]}> = {10:{color:'#368bdd',dash:[]},21:{color:'#d78a28',dash:[7,3]},50:{color:'#a478cf',dash:[2,3]}};
function drawDashedLine(context: CanvasRenderingContext2D, x1: number, y: number, x2: number, color: string, label: string) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.3;
  context.setLineDash([6, 5]);
  context.beginPath(); context.moveTo(x1, y); context.lineTo(x2, y); context.stroke();
  context.setLineDash([]);
  context.fillStyle = color;
  context.font = "12px system-ui";
  if (label) context.fillText(label, x1 + 4, Math.max(12, y - 5));
  context.restore();
}

export function ReplayCanvas({ model, cursor, enabledEma, currency, emaCandle, onInspect, onSelectMarker, rulerEnabled, rulerClear, onExitRuler }: { model: any; cursor: number; selectedEventId: string | null; enabledEma: number[]; currency: string; emaCandle: any; onInspect: (index: number | null) => void; onSelectMarker: (id:string) => void; rulerEnabled:boolean; rulerClear:number; onExitRuler:()=>void }) {
  const [geometry, setGeometry] = useState<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visibleCandles = useMemo(() => model.candles.slice(0, cursor + 1), [model.candles, cursor]);

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
      const darkReview = Boolean(styles.getPropertyValue("--review-chart-text").trim());
      context.scale(scale, scale);
      context.clearRect(0, 0, width, height);
      const padding = { top: width < 500 ? 60 : 30, right: 96, bottom: 28, left: 16 };
      const chartWidth = width - padding.left - padding.right;
      const volumeHeight = 84;
      const chartGap = 22;
      const chartHeight = height - padding.top - padding.bottom - volumeHeight - chartGap;
      const volumeTop = padding.top + chartHeight + chartGap;
      const visibleDate = visibleCandles.at(-1)?.date || model.windowStart;
      const planPrices = model.events.filter((event: any) => !event.legacy && ["PLAN_STOP", "PLAN_TARGET"].includes(event.type) && event.price > 0 && event.date <= visibleDate).map((event: any) => Number(event.price));
      const hasHolding = visibleCandles.some((candle: any) => candle.phase === "HOLDING");
      const overlayPrices = (model.overlays || []).map((item:any)=>item.price).filter((price:number)=>Number.isFinite(price)&&price>0);
      const prices = visibleCandles.flatMap((candle: any) => [candle.low, candle.high, ...enabledEma.map(period => candle.ema?.[period])]).concat(hasHolding ? [model.averageEntry, ...planPrices] : [], overlayPrices).filter((value: number) => Number.isFinite(value) && value > 0);
      const minimum = Math.min(...prices);
      const maximum = Math.max(...prices);
      const spread = Math.max(maximum - minimum, maximum * 0.04, 1);
      const low = minimum - spread * 0.08;
      const high = maximum + spread * 0.08;
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
        context.fillStyle = chartText; context.font = "12px system-ui"; context.fillText(price.toFixed(2), width - padding.right + 8, y + 3);
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

      const holdingStart = visibleCandles.findIndex((candle: any) => candle.phase === "HOLDING");
      const holdingEnd = visibleCandles.findLastIndex((candle: any) => candle.phase === "HOLDING");
      if (holdingStart >= 0 && holdingEnd >= holdingStart) {
        drawDashedLine(context, xFor(holdingStart), yFor(model.averageEntry), xFor(holdingEnd), darkReview ? "#9dcced" : "#2f5f7c", "");
      }
      const planEvents = model.events.filter((event: any) => !event.legacy && ["PLAN_STOP", "PLAN_TARGET"].includes(event.type) && event.price > 0);
      planEvents.forEach((event: any, index: number) => {
        const startIndex = visibleCandles.findIndex((candle: any) => candle.date >= event.date);
        if (startIndex < 0 || startIndex >= visibleCandles.length) return;
        const next = planEvents.slice(index + 1).find((candidate: any) => candidate.type === event.type && candidate.date);
        const nextIndex = next ? visibleCandles.findIndex((candle: any) => candle.date >= next.date) : -1;
        const endIndex = nextIndex > startIndex ? Math.min(visibleCandles.length - 1, nextIndex) : Math.min(visibleCandles.length - 1, Math.max(startIndex, holdingEnd));
        const color = event.type === "PLAN_STOP" ? (darkReview ? "#ffa59a" : "#b43f35") : (darkReview ? "#8bd6b4" : "#3f8a4d");
        drawDashedLine(context, xFor(startIndex), yFor(event.price), xFor(Math.max(startIndex, endIndex)), color, `${event.label} ${event.price.toFixed(2)}`);
      });

      const overlays:any[]=[];
      for(const line of model.overlays || []) {const same=overlays.find(item=>item.price===line.price);if(same)same.label+=' / '+line.label;else overlays.push({...line});}
      for (const line of overlays) {
        if (Number.isFinite(line.price) && line.price > 0) drawDashedLine(context, padding.left, yFor(line.price), width-padding.right, darkReview ? (line.darkColor || line.color) : line.color, `${line.label} ${Number(line.price).toLocaleString('en-US',{maximumFractionDigits:4})}`);
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
    const theme = matchMedia("(prefers-color-scheme: dark)");
    theme.addEventListener("change", draw);
    return () => { observer.disconnect(); theme.removeEventListener("change", draw); };
  }, [model, visibleCandles, enabledEma]);

  return <div className={`replay-canvas-stack ${rulerEnabled ? "is-measuring" : ""}`}><canvas ref={canvasRef} className="replay-canvas" role="img" aria-label={model.chartLabel || `${model.symbol} 進場前三個月到出場後三個月的日線交易決策重播；包含成交量、成交、計畫、MAE及MFE`}>交易決策重播圖</canvas><div className="ema-chart-values" aria-label="目前 K 棒均線">{enabledEma.map(period => <span key={period} style={{color:EMA_STYLE[period].color}}>EMA {period}：{emaCandle?.ema?.[period] == null ? "—" : emaCandle.ema[period].toFixed(2)}</span>)}</div>{geometry && !rulerEnabled && <ReplayCrosshair geometry={geometry} candles={visibleCandles} currency={currency} onInspect={onInspect}/>}{geometry && <ReplayEventMarkers key={rulerEnabled ? "measure" : "inspect"} interactive={!rulerEnabled} geometry={geometry} events={model.events} candles={visibleCandles} currency={currency} onSelect={onSelectMarker}/>}{geometry && rulerEnabled && <PriceRuler key={rulerClear} geometry={geometry} candles={visibleCandles} currency={currency} onInspect={onInspect} onExit={onExitRuler}/>}</div>;
}
