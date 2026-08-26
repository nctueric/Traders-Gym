/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildBehaviorDashboard, buildCycleReplay, buildOpenPositionReplay, buildTradeQualityAnalysis, filterCyclesByPeriod } from "@/lib/coach-engine.mjs";

function pct(value: number | null, digits = 1) { return value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`; }
function money(value: number | null, currency = "USD") { return value == null ? "—" : new Intl.NumberFormat("zh-TW", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
function volume(value: number | null) { return value == null ? "—" : new Intl.NumberFormat("zh-TW", { notation: "compact", maximumFractionDigits: 2 }).format(value); }
function dateInput(value: string) { return value ? new Date(value).toISOString().slice(0, 16) : ""; }

const EVENT_COLOR: Record<string, string> = {
  ENTRY: "#176b50", ADD: "#258664", REDUCE: "#d68b32", EXIT: "#a85d18",
  MAE: "#b43f35", MFE: "#176b50", PLAN_STOP: "#b43f35", PLAN_TARGET: "#3f8a4d",
  PLAN_INVALIDATION: "#765caa", RAPID_REPURCHASE: "#aa641e",
};

function drawDashedLine(context: CanvasRenderingContext2D, x1: number, y: number, x2: number, color: string, label: string) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.3;
  context.setLineDash([6, 5]);
  context.beginPath(); context.moveTo(x1, y); context.lineTo(x2, y); context.stroke();
  context.setLineDash([]);
  context.fillStyle = color;
  context.font = "10px Arial";
  context.fillText(label, x1 + 4, Math.max(12, y - 5));
  context.restore();
}

function ReplayCanvas({ model, cursor, selectedEventId }: { model: any; cursor: number; selectedEventId: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visibleCandles = useMemo(() => model.candles.slice(0, cursor + 1), [model.candles, cursor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visibleCandles.length) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(420, rect.width);
      const height = Math.max(440, rect.height);
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale);
      context.clearRect(0, 0, width, height);
      const padding = { top: 24, right: 64, bottom: 28, left: 16 };
      const chartWidth = width - padding.left - padding.right;
      const volumeHeight = 84;
      const chartGap = 22;
      const chartHeight = height - padding.top - padding.bottom - volumeHeight - chartGap;
      const volumeTop = padding.top + chartHeight + chartGap;
      const visibleDate = visibleCandles.at(-1)?.date || model.windowStart;
      const planPrices = model.events.filter((event: any) => !event.legacy && ["PLAN_STOP", "PLAN_TARGET"].includes(event.type) && event.price > 0 && event.date <= visibleDate).map((event: any) => Number(event.price));
      const hasHolding = visibleCandles.some((candle: any) => candle.phase === "HOLDING");
      const prices = visibleCandles.flatMap((candle: any) => [candle.low, candle.high]).concat(hasHolding ? [model.averageEntry, ...planPrices] : []).filter((value: number) => Number.isFinite(value) && value > 0);
      const minimum = Math.min(...prices);
      const maximum = Math.max(...prices);
      const spread = Math.max(maximum - minimum, maximum * 0.04, 1);
      const low = minimum - spread * 0.08;
      const high = maximum + spread * 0.08;
      const yFor = (price: number) => padding.top + (high - price) / (high - low) * chartHeight;
      const step = chartWidth / Math.max(visibleCandles.length, 1);
      const xFor = (index: number) => padding.left + step * (index + 0.5);

      context.strokeStyle = "#e4e5dc";
      context.lineWidth = 1;
      for (let row = 0; row <= 4; row += 1) {
        const y = padding.top + chartHeight * row / 4;
        context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke();
        const price = high - (high - low) * row / 4;
        context.fillStyle = "#66716e"; context.font = "10px Arial"; context.fillText(price.toFixed(2), width - padding.right + 8, y + 3);
      }

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
      context.strokeStyle = "#e4e5dc";
      context.beginPath(); context.moveTo(padding.left, volumeTop); context.lineTo(width - padding.right, volumeTop); context.stroke();
      context.fillStyle = "#66716e"; context.font = "10px Arial"; context.fillText("成交量", padding.left, volumeTop - 6);
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
        drawDashedLine(context, xFor(holdingStart), yFor(model.averageEntry), xFor(holdingEnd), "#2f5f7c", `均價 ${model.averageEntry.toFixed(2)}`);
      }
      const planEvents = model.events.filter((event: any) => !event.legacy && ["PLAN_STOP", "PLAN_TARGET"].includes(event.type) && event.price > 0);
      planEvents.forEach((event: any, index: number) => {
        const startIndex = visibleCandles.findIndex((candle: any) => candle.date >= event.date);
        if (startIndex < 0 || startIndex >= visibleCandles.length) return;
        const next = planEvents.slice(index + 1).find((candidate: any) => candidate.type === event.type && candidate.date);
        const nextIndex = next ? visibleCandles.findIndex((candle: any) => candle.date >= next.date) : -1;
        const endIndex = nextIndex > startIndex ? Math.min(visibleCandles.length - 1, nextIndex) : Math.min(visibleCandles.length - 1, Math.max(startIndex, holdingEnd));
        const color = event.type === "PLAN_STOP" ? "#b43f35" : "#3f8a4d";
        drawDashedLine(context, xFor(startIndex), yFor(event.price), xFor(Math.max(startIndex, endIndex)), color, `${event.label} ${event.price.toFixed(2)}`);
      });

      const markerEvents = model.events.filter((event: any) => event.date && event.price > 0 && event.date <= visibleCandles.at(-1)?.date && ["ENTRY", "ADD", "REDUCE", "EXIT", "MAE", "MFE"].includes(event.type));
      markerEvents.forEach((event: any) => {
        const index = visibleCandles.findIndex((candle: any) => candle.date >= event.date);
        if (index < 0) return;
        const x = xFor(index);
        const y = yFor(event.price);
        const selected = event.id === selectedEventId;
        context.beginPath(); context.arc(x, y, selected ? 7 : 5, 0, Math.PI * 2);
        context.fillStyle = EVENT_COLOR[event.type] || "#17211f"; context.fill();
        context.strokeStyle = selected ? "#17211f" : "#fffef9"; context.lineWidth = selected ? 3 : 1.5; context.stroke();
        if (["ENTRY", "ADD", "REDUCE", "EXIT"].includes(event.type)) {
          context.fillStyle = EVENT_COLOR[event.type] || "#17211f";
          context.font = "bold 9px Arial";
          context.fillText(event.label, Math.min(width - padding.right - 24, x + 6), Math.max(12, y - 7));
        }
      });

      context.fillStyle = "#66716e"; context.font = "10px Arial";
      const labelIndexes = [...new Set([0, Math.floor((visibleCandles.length - 1) / 2), visibleCandles.length - 1])];
      labelIndexes.forEach((index) => { const label = visibleCandles[index]?.date || ""; context.fillText(label.slice(5), Math.max(0, xFor(index) - 14), height - 10); });
      context.save(); context.strokeStyle = "#17211f33"; context.setLineDash([3, 4]); context.beginPath(); context.moveTo(xFor(visibleCandles.length - 1), padding.top); context.lineTo(xFor(visibleCandles.length - 1), volumeTop + volumeHeight); context.stroke(); context.restore();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [model, selectedEventId, visibleCandles]);

  return <canvas ref={canvasRef} className="replay-canvas" role="img" aria-label={`${model.symbol} 進場前三個月到出場後三個月的日線交易決策重播；包含成交量、成交、計畫、MAE及MFE`}>交易決策重播圖</canvas>;
}

export function ReplayBoard({ cycle, marketBars, planHistory, review, rapidPairs, decisionLinks, onAddPlanVersion, openPlan }: { cycle: any; marketBars: any[]; planHistory: any[]; review: any; rapidPairs: any[]; decisionLinks: Record<string, any>; onAddPlanVersion: (version: any) => void; openPlan?: any }) {
  const isOpen = cycle.status === "OPEN";
  const model = useMemo(() => isOpen ? buildOpenPositionReplay(cycle, marketBars, planHistory, openPlan || {}) : buildCycleReplay(cycle, marketBars, planHistory, review, rapidPairs, decisionLinks), [cycle, decisionLinks, isOpen, marketBars, openPlan, planHistory, rapidPairs, review]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ field: "stopLoss", value: "", effectiveAt: dateInput(cycle.openAt), reason: "" });
  const replayCursor = cursor == null ? Math.max(0, model.candles.length - 1) : Math.min(cursor, Math.max(0, model.candles.length - 1));
  const cursorDate = model.candles[replayCursor]?.date || model.closeDate;
  const cursorCandle = model.candles[replayCursor] || null;
  const cursorPhase = cursorCandle?.phase === "PRE_ENTRY" ? "進場前" : cursorCandle?.phase === "POST_EXIT" ? "出場後" : "持有期間";
  const selectedEvent = model.events.find((event: any) => event.id === selectedEventId) || null;

  function selectEvent(event: any) {
    setSelectedEventId(event.id);
    if (event.date) {
      const index = model.candles.findIndex((candle: any) => candle.date >= event.date);
      if (index >= 0) setCursor(index);
    }
  }

  function addVersion(event: React.FormEvent) {
    event.preventDefault();
    const rawValue = planForm.field === "invalidation" ? planForm.value.trim() : Number(planForm.value);
    if (!planForm.value.trim() || !planForm.effectiveAt || (planForm.field !== "invalidation" && !(Number(rawValue) > 0))) return;
    const createdAt = new Date().toISOString();
    onAddPlanVersion({ id: `plan-${cycle.id}-${Date.now()}`, cycleId: cycle.id, accountId: cycle.accountId, symbol: cycle.symbol, field: planForm.field, value: rawValue, reason: planForm.reason.trim(), effectiveAt: new Date(planForm.effectiveAt).toISOString(), createdAt, source: !isOpen && createdAt > cycle.closeAt ? "POST_HOC" : "USER" });
    setPlanForm((current) => ({ ...current, value: "", reason: "" }));
  }

  return <section className="replay-board">
    <div className="replay-head"><div><p className="eyebrow">DECISION REPLAY</p><h3>{isOpen ? "持倉 K 線與交易計畫" : "交易決策重播"}</h3><small>{isOpen ? "進場前三個月 → 目前・進場位置與最新停損／停利" : "進場前三個月 → 出場後三個月・完整日K價量"}</small></div><div className="replay-legend"><span><i className="entry-dot"/>建倉／加碼</span><span><i className="exit-dot"/>減碼／出場</span><span><i className="stop-line"/>停損</span><span><i className="target-line"/>停利</span><span><i className="volume-bar"/>成交量</span><span><i className="volume-average"/>20日均量</span></div></div>
    {model.sameDay && <div className="precision-warning"><b>同日交易・日線近似</b><span>只顯示當日OHLC，不推測盤中成交先後與MAE／MFE發生順序。</span></div>}
    <div className="replay-layout"><div className="replay-chart">{!model.candles.length ? <div className="replay-empty"><b>缺少可重播的OHLC行情</b><span>圖表不補造價格；右側仍保留成交與計畫證據。</span></div> : <><ReplayCanvas model={model} cursor={replayCursor} selectedEventId={selectedEventId}/>{cursorCandle && <div className="replay-market-strip"><div className="replay-market-day"><b>{cursorCandle.date}</b><span>{cursorPhase}</span></div><div><span>開盤</span><b>{cursorCandle.open.toFixed(2)}</b></div><div><span>最高</span><b>{cursorCandle.high.toFixed(2)}</b></div><div><span>最低</span><b>{cursorCandle.low.toFixed(2)}</b></div><div><span>收盤</span><b>{cursorCandle.close.toFixed(2)}</b></div><div><span>當日成交量</span><b>{volume(cursorCandle.volume)}</b></div><div><span>20日均量</span><b>{volume(cursorCandle.averageVolume20)}</b></div><div><span>量比</span><b className={cursorCandle.volumeRatio != null && cursorCandle.volumeRatio >= 1.5 ? "volume-hot" : ""}>{cursorCandle.volumeRatio == null ? "—" : `${cursorCandle.volumeRatio.toFixed(2)}x`}</b></div></div>}<label className="replay-slider"><span>重播至 {cursorDate}</span><input aria-label="交易重播日期" type="range" min="0" max={Math.max(0, model.candles.length - 1)} value={replayCursor} onChange={(event) => setCursor(Number(event.target.value))}/><small>{replayCursor + 1}/{model.candles.length}・進場前 {model.preEntryCount}／持有 {model.holdingCount}／出場後 {model.postExitCount} 個交易日</small></label></>} </div><aside className="replay-timeline"><div className="timeline-title"><b>事件時間軸</b><span>{model.events.length} 個可追溯事件</span></div><div className="timeline-events">{model.events.map((event: any) => <button key={event.id} type="button" className={`${selectedEventId === event.id ? "selected" : ""} ${event.date && event.date > cursorDate ? "future" : ""}`} onClick={() => selectEvent(event)}><i style={{ background: EVENT_COLOR[event.type] || "#765caa" }}/><span><b>{event.label}</b><small>{event.date || "時間不明"}・{event.detail}</small></span></button>)}</div>{selectedEvent && <div className="event-inspector"><span>目前選取</span><b>{selectedEvent.label}</b><p>{selectedEvent.detail}</p>{selectedEvent.price > 0 && <small>價格 {money(selectedEvent.price, cycle.currency)}</small>}{selectedEvent.quantity > 0 && <small>數量 {selectedEvent.quantity} 股・部位 {selectedEvent.beforeQuantity} → {selectedEvent.afterQuantity}</small>}{selectedEvent.note && <small>{selectedEvent.note}</small>}</div>}</aside></div>
    {model.legacyPlanCount > 0 && <div className="legacy-plan-note">有 {model.legacyPlanCount} 項舊計畫只有最終值、沒有生效時間；已顯示為「歷史值」，不加入動畫時序。</div>}
    <form className="plan-version-form" onSubmit={addVersion}><div><b>新增計畫版本</b><small>建立後只追加，不覆蓋舊版本；{isOpen ? "平倉後會沿用同一筆交易 ID 進入閉環與行為分析。" : "事後補登會保留建立時間。"}</small></div><label>類型<select value={planForm.field} onChange={(event) => setPlanForm({ ...planForm, field: event.target.value })}><option value="stopLoss">停損</option><option value="takeProfit">停利</option><option value="invalidation">失效條件</option></select></label><label>{planForm.field === "invalidation" ? "條件" : "價格"}<input required type={planForm.field === "invalidation" ? "text" : "number"} min={planForm.field === "invalidation" ? undefined : "0"} step="any" value={planForm.value} onChange={(event) => setPlanForm({ ...planForm, value: event.target.value })}/></label><label>生效時間<input required type="datetime-local" value={planForm.effectiveAt} onChange={(event) => setPlanForm({ ...planForm, effectiveAt: event.target.value })}/></label><label>理由<input value={planForm.reason} placeholder="支撐、型態或規則依據" onChange={(event) => setPlanForm({ ...planForm, reason: event.target.value })}/></label><button className="primary" type="submit">加入時間線</button></form>
  </section>;
}

function score(value: number | null) { return value == null ? "—" : String(Math.round(value * 100)); }
function scoreTone(value: number | null) { return value == null ? "missing" : value >= 0.7 ? "good" : value >= 0.4 ? "average" : "weak"; }
function clamp(value: number, minimum = 0, maximum = 1) { return Math.max(minimum, Math.min(maximum, value)); }

function ScatterPlot({ title, subtitle, points, xValue, yValue, xLabel, yLabel, onSelect }: { title: string; subtitle: string; points: any[]; xValue: (point: any) => number; yValue: (point: any) => number; xLabel: string; yLabel: string; onSelect: (cycleId: string) => void }) {
  const xValues = points.map(xValue).filter(Number.isFinite);
  const yValues = points.map(yValue).filter(Number.isFinite);
  const xMin = Math.min(...xValues, -0.01);
  const xMax = Math.max(...xValues, 0.01);
  const yMin = Math.min(...yValues, -0.01);
  const yMax = Math.max(...yValues, 0.01);
  const xRange = Math.max(xMax - xMin, 0.01);
  const yRange = Math.max(yMax - yMin, 0.01);
  return <article className="behavior-chart"><div><b>{title}</b><small>{subtitle}・{points.length} 筆可追溯樣本</small></div>{points.length ? <div className="scatter-stage"><span className="axis-x">{xLabel}</span><span className="axis-y">{yLabel}</span><i className="zero-x" style={{ bottom: `${clamp((0 - yMin) / yRange) * 100}%` }}/><i className="zero-y" style={{ left: `${clamp((0 - xMin) / xRange) * 100}%` }}/>{points.map((point) => <button type="button" key={point.cycleId} className={`scatter-point ${String(point.category || "").toLowerCase()}`} style={{ left: `${clamp((xValue(point) - xMin) / xRange) * 94 + 3}%`, bottom: `${clamp((yValue(point) - yMin) / yRange) * 88 + 6}%` }} title={`${point.symbol}：${xLabel} ${pct(xValue(point))}，${yLabel} ${pct(yValue(point))}`} onClick={() => onSelect(point.cycleId)}>{point.symbol.slice(0, 4)}</button>)}</div> : <div className="mini-empty">這個期間尚無可顯示的行情樣本。</div>}</article>;
}

function QualitySummaryCard({ kind, title, scoreValue, sampleRate, metrics, weakest, onSelect }: { kind: "entry" | "exit"; title: string; scoreValue: number | null; sampleRate: number | null; metrics: { label: string; value: string; note: string }[]; weakest: any[]; onSelect: (cycleId: string) => void }) {
  return <article className={`quality-summary-card ${kind}`}><div className="quality-card-head"><div><span>{kind === "entry" ? "ENTRY QUALITY" : "EXIT QUALITY"}</span><h2>{title}</h2></div><div className={`quality-score ${scoreTone(scoreValue)}`}><b>{score(scoreValue)}</b><small>/100</small></div></div><div className="quality-verdict"><b>{scoreValue == null ? "行情不足" : scoreValue >= 0.7 ? "整體位置良好" : scoreValue >= 0.4 ? "整體位置普通" : "整體需要改善"}</b><span>位置良好比例 {pct(sampleRate)}</span></div><div className="quality-metrics">{metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><b>{metric.value}</b><small>{metric.note}</small></div>)}</div><div className="quality-watchlist"><div><b>優先回顧</b><span>位置分數最低的交易</span></div>{weakest.length ? weakest.map((trade) => <button type="button" key={trade.cycleId} onClick={() => onSelect(trade.cycleId)}><span><b>{trade.symbol}</b><small>{trade.openDate} → {trade.closeDate}</small></span><strong>{score(kind === "entry" ? trade.entryScore : trade.exitScore)}</strong></button>) : <small>尚無足夠行情樣本</small>}</div></article>;
}

export function TrainingWorkspace({ cycles, positions = [], plans = {}, marketBars, reviews, onSelectCycle, onSelectPosition }: { cycles: any[]; positions?: any[]; plans?: Record<string, any>; marketBars: any[]; reviews: Record<string, any>; onSelectCycle: (cycleId: string) => void; onSelectPosition?: (positionId: string) => void }) {
  const months = useMemo(() => [...new Set(cycles.map((cycle) => String(cycle.closeAt).slice(0, 7)))].sort(), [cycles]);
  const [startMonth, setStartMonth] = useState("");
  const [endMonth, setEndMonth] = useState("");
  const [sampleLimit, setSampleLimit] = useState("0");
  const periodCycles = useMemo(() => filterCyclesByPeriod(cycles, startMonth, endMonth, Number(sampleLimit)), [cycles, endMonth, sampleLimit, startMonth]);
  const quality = useMemo(() => buildTradeQualityAnalysis(periodCycles, marketBars, reviews), [marketBars, periodCycles, reviews]);
  const matrices = useMemo(() => buildBehaviorDashboard(periodCycles, marketBars, reviews, [], []), [marketBars, periodCycles, reviews]);
  const summary = quality.summary;
  return <div className="training-workspace quality-workspace">
    <section className="quality-intro"><div><p className="eyebrow">TRADE BEHAVIOR ANALYSIS</p><h2>從交易計畫一路追到行為證據</h2><p>同一筆交易 ID 串接建倉、目前持倉、平倉閉環與行為分析；分數不是盈虧評分，每一筆都能回到 K 線、進場點與停損版本。</p></div><div className="quality-coverage"><span>目前持倉 <b>{positions.length}</b></span><span>已分析閉環 <b>{summary.total}</b></span><span>進／出場回顧 <b>{summary.entryReviewedCount}／{summary.exitReviewedCount}</b></span></div></section>
    <section className="trade-lifecycle"><div className="panel-head"><div><p className="eyebrow">TRADE LIFECYCLE</p><h2>完整交易計畫路徑</h2></div><span className="muted">平倉後自動沿用同一筆交易 ID</span></div><div className="lifecycle-steps"><div><b>1</b><span>開倉與計畫<small>成交、停損、停利、失效條件</small></span></div><i>→</i><div className="active"><b>2</b><span>目前持倉<small>{positions.length} 筆進行中</small></span></div><i>→</i><div><b>3</b><span>交易閉環<small>{cycles.length} 筆已平倉</small></span></div><i>→</i><div><b>4</b><span>行為分析<small>K 線、MFE、MAE 證據</small></span></div></div>{positions.length ? <div className="lifecycle-positions">{positions.map((position) => { const plan = plans[position.id] || plans[`${position.accountId}:${position.symbol}`] || {}; const planCount = [Number(plan.stopLoss) > 0, Number(plan.takeProfit) > 0, Boolean(String(plan.note || "").trim())].filter(Boolean).length; return <article key={position.id || `${position.accountId}:${position.symbol}`}><div><b>{position.symbol} <span className={`direction ${String(position.direction).toLowerCase()}`}>{position.direction === "SHORT" ? "空" : "多"}</span></b><small>{position.openAt.slice(0, 10)} 開倉・計畫完整 {planCount}/3</small></div><div><span>停損 {Number(plan.stopLoss) > 0 ? money(Number(plan.stopLoss), position.currency) : "待設定"}</span><button type="button" className="ghost" onClick={() => onSelectPosition?.(position.id)}>看持倉K線與計畫</button></div></article>; })}</div> : <div className="mini-empty">目前沒有持倉；新開倉會自動進入這條路徑。</div>}</section>
    <section className="matrix-section"><div className="matrix-head"><div><p className="eyebrow">EXCURSION MATRICES</p><h2>MFE 留存與 MAE 報酬矩陣</h2><p>篩選出場年月區間與呈現筆數；點選樣本直接回到原始閉環 K 線。</p></div><div className="matrix-filters"><label>開始年月<select value={startMonth} onChange={(event) => setStartMonth(event.target.value)}><option value="">全部</option>{months.map((month) => <option key={month} value={month}>{month}</option>)}</select></label><label>結束年月<select value={endMonth} onChange={(event) => setEndMonth(event.target.value)}><option value="">全部</option>{months.map((month) => <option key={month} value={month}>{month}</option>)}</select></label><label>呈現筆數<select value={sampleLimit} onChange={(event) => setSampleLimit(event.target.value)}><option value="0">全部</option><option value="10">最新 10 筆</option><option value="25">最新 25 筆</option><option value="50">最新 50 筆</option></select></label><strong>顯示 {periodCycles.length}／{cycles.length} 筆</strong></div></div><div className="behavior-grid"><ScatterPlot title="MFE 留存矩陣" subtitle="辨識高浮盈回吐與高留存出場" points={matrices.retention} xValue={(point) => point.mfePct} yValue={(point) => point.retention} xLabel="MFE" yLabel="留存率" onSelect={onSelectCycle}/><ScatterPlot title="MAE 報酬矩陣" subtitle="辨識深度套牢與有效風控" points={matrices.maeReturn} xValue={(point) => point.maePct} yValue={(point) => point.returnPct} xLabel="MAE" yLabel="實際報酬" onSelect={onSelectCycle}/></div></section>
    <section className="quality-dual-grid">
      <QualitySummaryCard kind="entry" title="買得好不好？" scoreValue={summary.averageEntryScore} sampleRate={summary.goodEntryRate} onSelect={onSelectCycle} weakest={quality.weakestEntries} metrics={[{ label: "進場後3日順向率", value: pct(summary.entryFollowThroughRate), note: "3個交易日後仍朝交易方向" }, { label: "平均最大反向波動", value: pct(summary.averageMae), note: "進場後承受的 MAE" }, { label: "完成進場回顧", value: `${summary.entryReviewedCount}/${summary.total}`, note: "已記錄買點依據與改善位置" }]}/>
      <QualitySummaryCard kind="exit" title="賣得好不好？" scoreValue={summary.averageExitScore} sampleRate={summary.goodExitRate} onSelect={onSelectCycle} weakest={quality.weakestExits} metrics={[{ label: "平均MFE留存", value: pct(summary.averageMfeRetention), note: "實際報酬保留最大浮盈比例" }, { label: "偏早出場率", value: pct(summary.earlyExitRate), note: "出場後5日仍順向超過3%" }, { label: "完成出場回顧", value: `${summary.exitReviewedCount}/${summary.total}`, note: "已記錄出場理由與改善位置" }]}/>
    </section>
    <section className="quality-ledger"><div className="panel-head"><div><p className="eyebrow">EVIDENCE LEDGER</p><h2>逐筆進出場品質</h2></div><span className="muted">與上方年月、筆數篩選同步・多單買低賣高，空單放空高回補低</span></div>{quality.trades.length ? <div className="table-wrap"><table><thead><tr><th>閉環</th><th>進場位置</th><th>進場後3日</th><th>MAE</th><th>進場回顧</th><th>出場位置</th><th>MFE留存</th><th>出場後5日</th><th>出場回顧</th><th>證據</th></tr></thead><tbody>{[...quality.trades].sort((a, b) => b.closeDate.localeCompare(a.closeDate)).map((trade) => <tr key={trade.cycleId}><td><b>{trade.symbol}</b><small>{trade.direction === "SHORT" ? "空" : "多"}・{trade.openDate} → {trade.closeDate}</small></td><td><span className={`quality-pill ${scoreTone(trade.entryScore)}`}>{score(trade.entryScore)}分</span><small>{trade.entryLabel}</small></td><td className={trade.entryFollowThrough3 != null && trade.entryFollowThrough3 >= 0 ? "positive" : "negative"}>{pct(trade.entryFollowThrough3)}</td><td className={trade.maePct != null && trade.maePct < -0.1 ? "negative" : ""}>{pct(trade.maePct)}</td><td className="review-cell"><span className={`review-state ${trade.entryReviewed ? "done" : "pending"}`}>{trade.entryReviewed ? "已完成" : "待補"}</span><small title={trade.entryReview}>{trade.entryReview || "尚未填寫買點回顧"}</small></td><td><span className={`quality-pill ${scoreTone(trade.exitScore)}`}>{score(trade.exitScore)}分</span><small>{trade.exitLabel}</small></td><td>{pct(trade.mfeRetention)}</td><td className={trade.postExit5 != null && trade.postExit5 > 0.03 ? "negative" : ""}>{pct(trade.postExit5)}</td><td className="review-cell"><span className={`review-state ${trade.exitReviewed ? "done" : "pending"}`}>{trade.exitReviewed ? "已完成" : "待補"}</span><small title={trade.exitReview}>{trade.exitReview || "尚未填寫賣點回顧"}</small></td><td><button type="button" className="ghost" onClick={() => onSelectCycle(trade.cycleId)}>看K線與回顧</button></td></tr>)}</tbody></table></div> : <div className="mini-empty">這個期間尚無完整交易閉環可分析。</div>}<div className="quality-method"><b>評分方式</b><span>進場位置：進場價位於持有期間價格區間的有利程度；出場位置：出場價位於同一區間的有利程度。0 分接近最不利端，100 分接近最有利端。日線只能做日線近似，不推測盤中先後。</span></div></section>
  </div>;
}
