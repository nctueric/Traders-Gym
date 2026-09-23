/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useRef, useState } from "react";
import { inspectChartPoint } from "@/lib/chart-indicators.mjs";

export function ReplayCrosshair({ geometry: g, candles, currency, onInspect }: { geometry: any; candles: any[]; currency: string; onInspect: (index: number | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onInspect);
  useEffect(() => { callback.current = onInspect; }, [onInspect]);
  const [anchor, setPoint] = useState<any>(null);
  const point=anchor && candles.length ? {...anchor,index:Math.min(anchor.index,candles.length-1),x:g.left+g.step*(Math.min(anchor.index,candles.length-1)+.5),y:anchor.price==null?anchor.y:g.top+(g.high-anchor.price)/(g.high-g.low)*(g.priceBottom-g.top)} : null;
  const clear = () => { setPoint(null); callback.current(null); };
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) { setPoint(null); callback.current(null); } };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); callback.current(null); };
  }, []);
  function select(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const next = inspectChartPoint(g, candles.length, (event.clientX - rect.left) * g.width / rect.width, (event.clientY - rect.top) * g.height / rect.height);
    setPoint(next); callback.current(next?.index ?? null);
  }
  const dateX = point ? Math.max(0, Math.min(g.width - 98, point.x - 49)) : 0;
  return <div ref={ref} className="replay-inspection" tabIndex={0} role="slider" aria-valuemin={1} aria-valuemax={candles.length} aria-valuenow={(point?.index ?? candles.length-1)+1} aria-valuetext={candles[point?.index ?? candles.length-1]?.date} aria-label="K 線逐棒檢視，左右鍵選擇，Escape 取消" onBlur={clear} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); clear(); return; }
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const index = Math.max(0, Math.min(candles.length - 1, (point?.index ?? candles.length - 1) + (event.key === "ArrowLeft" ? -1 : 1)));
    const price = candles[index].close;
    setPoint({ index, x:g.left + g.step * (index + 0.5), y:g.top + (g.high-price)/(g.high-g.low)*(g.priceBottom-g.top), price }); callback.current(index);
  }}>
    <svg viewBox={`0 0 ${g.width} ${g.height}`} preserveAspectRatio="none" aria-hidden="true" onPointerMove={(event) => { if(event.pointerType !== "touch") select(event); }} onPointerUp={(event) => { if(event.pointerType === "touch") select(event); }} onPointerLeave={(event) => { if(event.pointerType !== "touch") clear(); }}>
      {point && <g className="crosshair-lines"><line x1={point.x} x2={point.x} y1={g.top} y2={g.volumeBottom}/>{point.price !== null && <><line x1={g.left} x2={g.right} y1={point.y} y2={point.y}/><rect x={g.right} y={Math.max(0,Math.min(g.height-34,point.y-17))} width={g.width-g.right} height={34}/><text x={g.right+5} y={point.y-2}>{point.price.toFixed(2)}</text><text x={g.right+5} y={point.y+12}>{currency} 游標價</text></>}<rect x={dateX} y={g.height-24} width={98} height={24}/><text x={dateX+5} y={g.height-8}>{candles[point.index].date}</text></g>}
    </svg>
  </div>;
}
