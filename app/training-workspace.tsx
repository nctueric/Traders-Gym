/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { themedContext, observeChartTheme } from "./chart-theme";

import { ENTRY_OPTIONS, VOLUME_OPTIONS, filterCyclesByEntry, contextsForCycle } from "@/lib/trade-entry.mjs";
import { EntryContextEvidence } from "./trade-entry-workspace";
import { replayFocus } from "@/lib/position-ledger.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildBehaviorDashboard, buildCycleReplay, buildMonthlyExpectancyTrend, buildOpenPositionReplay, buildProfitLossTradeStats, buildTradeQualityAnalysis, cycleAnalysisPeriod, filterCyclesByPeriod } from "@/lib/coach-engine.mjs";
import { buildStrategyAnalysis } from "@/lib/strategy-engine.mjs";
import { QualityTagPicker } from "./quality-rating-control";
import { SectionLinks } from "./workspace-ui";

function pct(value: number | null, digits = 1) { return value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`; }
function plainPct(value: number | null, digits = 1) { return value == null ? "—" : `${(value * 100).toFixed(digits)}%`; }
function money(value: number | null, currency = "USD") { return value == null ? "—" : new Intl.NumberFormat("zh-TW", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2 }).format(value); }
function volume(value: number | null) { return value == null ? "—" : new Intl.NumberFormat("zh-TW", { notation: "compact", maximumFractionDigits: 2 }).format(value); }
function dateInput(value: string) { return value ? new Date(value).toISOString().slice(0, 16) : ""; }

const EVENT_COLOR: Record<string, string> = {
  ENTRY: "#69c6a7", ADD: "#7bcbb2", REDUCE: "#d68b32", EXIT: "#a85d18",
  MAE: "#ee918b", MFE: "#69c6a7", PLAN_STOP: "#ee918b", PLAN_TARGET: "#69c6a7",
  PLAN_INVALIDATION: "#765caa", RAPID_REPURCHASE: "#aa641e",
  STRATEGY_ASSIGNED: "#8ab8f4", RULE_FOLLOWED: "#69c6a7", RULE_VIOLATED: "#ee918b",
};

function drawDashedLine(context: CanvasRenderingContext2D, x1: number, y: number, x2: number, color: string, label: string) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.3;
  context.setLineDash([6, 5]);
  context.beginPath(); context.moveTo(x1, y); context.lineTo(x2, y); context.stroke();
  context.setLineDash([]);
  context.fillStyle = color;
  context.font = "12px system-ui";
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
      const context = themedContext(canvas);
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

      context.strokeStyle = "#343c49";
      context.lineWidth = 1;
      for (let row = 0; row <= 4; row += 1) {
        const y = padding.top + chartHeight * row / 4;
        context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke();
        const price = high - (high - low) * row / 4;
        context.fillStyle = "#a6b0c1"; context.font = "12px system-ui"; context.fillText(price.toFixed(2), width - padding.right + 8, y + 3);
      }

      visibleCandles.forEach((candle: any, index: number) => {
        const x = xFor(index);
        const rising = candle.close >= candle.open;
        context.strokeStyle = rising ? "#69c6a7" : "#ee918b";
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
      context.strokeStyle = "#343c49";
      context.beginPath(); context.moveTo(padding.left, volumeTop); context.lineTo(width - padding.right, volumeTop); context.stroke();
      context.fillStyle = "#a6b0c1"; context.font = "12px system-ui"; context.fillText("成交量", padding.left, volumeTop - 6);
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
        drawDashedLine(context, xFor(holdingStart), yFor(model.averageEntry), xFor(holdingEnd), "#8ab8f4", `均價 ${model.averageEntry.toFixed(2)}`);
      }
      const planEvents = model.events.filter((event: any) => !event.legacy && ["PLAN_STOP", "PLAN_TARGET"].includes(event.type) && event.price > 0);
      planEvents.forEach((event: any, index: number) => {
        const startIndex = visibleCandles.findIndex((candle: any) => candle.date >= event.date);
        if (startIndex < 0 || startIndex >= visibleCandles.length) return;
        const next = planEvents.slice(index + 1).find((candidate: any) => candidate.type === event.type && candidate.date);
        const nextIndex = next ? visibleCandles.findIndex((candle: any) => candle.date >= next.date) : -1;
        const endIndex = nextIndex > startIndex ? Math.min(visibleCandles.length - 1, nextIndex) : Math.min(visibleCandles.length - 1, Math.max(startIndex, holdingEnd));
        const color = event.type === "PLAN_STOP" ? "#ee918b" : "#69c6a7";
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
        context.fillStyle = EVENT_COLOR[event.type] || "#e1e6ef"; context.fill();
        context.strokeStyle = selected ? "#e1e6ef" : "#151a22"; context.lineWidth = selected ? 3 : 1.5; context.stroke();
        if (["ENTRY", "ADD", "REDUCE", "EXIT"].includes(event.type)) {
          context.fillStyle = EVENT_COLOR[event.type] || "#e1e6ef";
          context.font = "bold 12px system-ui";
          context.fillText(event.label, Math.min(width - padding.right - 24, x + 6), Math.max(12, y - 7));
        }
      });

      context.fillStyle = "#a6b0c1"; context.font = "12px system-ui";
      const labelIndexes = [...new Set([0, Math.floor((visibleCandles.length - 1) / 2), visibleCandles.length - 1])];
      labelIndexes.forEach((index) => { const label = visibleCandles[index]?.date || ""; context.fillText(label.slice(5), Math.max(0, xFor(index) - 14), height - 10); });
      context.save(); context.strokeStyle = "#17211f33"; context.setLineDash([3, 4]); context.beginPath(); context.moveTo(xFor(visibleCandles.length - 1), padding.top); context.lineTo(xFor(visibleCandles.length - 1), volumeTop + volumeHeight); context.stroke(); context.restore();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    const themeObserver = observeChartTheme(draw);
    return () => { observer.disconnect(); themeObserver.disconnect(); };
  }, [model, selectedEventId, visibleCandles]);

  return <canvas ref={canvasRef} className="replay-canvas" role="img" aria-label={`${model.symbol} 進場前三個月到出場後三個月的日線交易決策重播；包含成交量、成交、計畫、MAE及MFE`}>交易決策重播圖</canvas>;
}

export function ReplayBoard({ entryContexts = {}, initialEventId, cycle, marketBars, planHistory, review, rapidPairs, decisionLinks, strategies = [], strategyAssignments = {}, onAddPlanVersion, openPlan }: { entryContexts?: Record<string, any>; initialEventId?: string; cycle: any; marketBars: any[]; planHistory: any[]; review: any; rapidPairs: any[]; decisionLinks: Record<string, any>; strategies?: any[]; strategyAssignments?: Record<string, any>; onAddPlanVersion: (version: any) => void; openPlan?: any }) {
  const isOpen = cycle.status === "OPEN";
  const model = useMemo(() => isOpen ? buildOpenPositionReplay(cycle, marketBars, planHistory, openPlan || {}, new Date(), strategies, strategyAssignments, entryContexts) : buildCycleReplay(cycle, marketBars, planHistory, review, rapidPairs, decisionLinks, strategies, strategyAssignments, entryContexts), [cycle, decisionLinks, isOpen, marketBars, openPlan, planHistory, rapidPairs, review, strategies, strategyAssignments, entryContexts]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(initialEventId || null);
  const focused = replayFocus(model, selectedEventId);
  const [planForm, setPlanForm] = useState({ field: "stopLoss", value: "", effectiveAt: dateInput(cycle.openAt), reason: "" });
  const replayCursor = cursor == null ? (focused.cursor ?? Math.max(0, model.candles.length - 1)) : Math.min(cursor, Math.max(0, model.candles.length - 1));
  const cursorDate = model.candles[replayCursor]?.date || model.closeDate;
  const cursorCandle = model.candles[replayCursor] || null;
  const cursorPhase = cursorCandle?.phase === "PRE_ENTRY" ? "進場前" : cursorCandle?.phase === "POST_EXIT" ? "出場後" : "持有期間";
  const selectedEvent = model.events.find((event: any) => event.id === selectedEventId) || null;

  function selectEvent(event: any) {
    setSelectedEventId(event.id);
    if (event.date) {
      setCursor(replayFocus(model, event.id).cursor);
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
    <div className="replay-head"><div><h3>{isOpen ? "持倉 K 線與交易計畫" : "交易決策重播"}</h3><small>{isOpen ? "進場前三個月 → 目前・進場位置與最新停損／停利" : "進場前三個月 → 出場後三個月・完整日K價量"}</small></div><div className="replay-legend"><span><i className="entry-dot"/>建倉／加碼</span><span><i className="exit-dot"/>減碼／出場</span><span><i className="stop-line"/>停損</span><span><i className="target-line"/>停利</span><span><i className="volume-bar"/>成交量</span><span><i className="volume-average"/>20日均量</span></div></div>
    {model.sameDay && <div className="precision-warning"><b>同日交易・日線近似</b><span>只顯示當日OHLC，不推測盤中成交先後與MAE／MFE發生順序。</span></div>}
    {focused.missingCandle && <p className="precision-warning" role="status">已選取 {focused.event.date} 的成交／事件，但目前缺少該日日K；保留事件資料，不以其他日期代替。</p>}
    <div className="replay-layout"><div className="replay-chart">{!model.candles.length ? <div className="replay-empty"><b>缺少可重播的OHLC行情</b><span>圖表不補造價格；右側仍保留成交與計畫證據。</span></div> : <><ReplayCanvas model={model} cursor={replayCursor} selectedEventId={selectedEventId}/>{cursorCandle && <div className="replay-market-strip"><div className="replay-market-day"><b>{cursorCandle.date}</b><span>{cursorPhase}</span></div><div><span>開盤</span><b>{cursorCandle.open.toFixed(2)}</b></div><div><span>最高</span><b>{cursorCandle.high.toFixed(2)}</b></div><div><span>最低</span><b>{cursorCandle.low.toFixed(2)}</b></div><div><span>收盤</span><b>{cursorCandle.close.toFixed(2)}</b></div><div><span>當日成交量</span><b>{volume(cursorCandle.volume)}</b></div><div><span>20日均量</span><b>{volume(cursorCandle.averageVolume20)}</b></div><div><span>量比</span><b className={cursorCandle.volumeRatio != null && cursorCandle.volumeRatio >= 1.5 ? "volume-hot" : ""}>{cursorCandle.volumeRatio == null ? "—" : `${cursorCandle.volumeRatio.toFixed(2)}x`}</b></div></div>}<label className="replay-slider"><span>重播至 {cursorDate}</span><input aria-label="交易重播日期" type="range" min="0" max={Math.max(0, model.candles.length - 1)} value={replayCursor} onChange={(event) => setCursor(Number(event.target.value))}/><small>{replayCursor + 1}/{model.candles.length}・進場前 {model.preEntryCount}／持有 {model.holdingCount}／出場後 {model.postExitCount} 個交易日</small></label></>} </div><aside className="replay-timeline"><div className="timeline-title"><b>事件時間軸</b><span>{model.events.length} 個可追溯事件</span></div><div className="timeline-events">{model.events.map((event: any) => <button key={event.id} type="button" className={`${selectedEventId === event.id ? "selected" : ""} ${event.date && event.date > cursorDate ? "future" : ""}`} onClick={() => selectEvent(event)}><i style={{ background: EVENT_COLOR[event.type] || "#765caa" }}/><span><b>{event.label}</b><small>{event.date || "時間不明"}・{event.detail}</small></span></button>)}</div>{selectedEvent && <div className="event-inspector"><span>目前選取</span><b>{selectedEvent.label}</b><p>{selectedEvent.detail}</p>{selectedEvent.price > 0 && <small>價格 {money(selectedEvent.price, cycle.currency)}</small>}{"quantity" in selectedEvent && selectedEvent.quantity > 0 && <small>數量 {selectedEvent.quantity} 股・部位 {selectedEvent.beforeQuantity} → {selectedEvent.afterQuantity}</small>}{"note" in selectedEvent && selectedEvent.note && <small>{selectedEvent.note}</small>}</div>}</aside></div>
    {selectedEvent && "entryContext" in selectedEvent && <EntryContextEvidence contexts={{[(selectedEvent as any).entryContext.fillId]:(selectedEvent as any).entryContext}} cycleId={cycle.id}/>}
    {model.legacyPlanCount > 0 && <div className="legacy-plan-note">有 {model.legacyPlanCount} 項舊計畫只有最終值、沒有生效時間；已顯示為「歷史值」，不加入動畫時序。</div>}
    {isOpen ? <div className="open-plan-replay-note">請在下方「目前計畫」更新停損、停利與失效條件；每次離開欄位即追加版本，平倉後會沿同一筆交易 ID 進入閉環與行為分析。</div> : <form data-detail-dirty={Boolean(planForm.value || planForm.reason)} className="plan-version-form" onSubmit={addVersion}><div><b>新增計畫版本</b><small>建立後只追加，不覆蓋舊版本；事後補登會保留建立時間。</small></div><label>類型<select value={planForm.field} onChange={(event) => setPlanForm({ ...planForm, field: event.target.value })}><option value="stopLoss">停損</option><option value="takeProfit">停利</option><option value="invalidation">失效條件</option></select></label><label>{planForm.field === "invalidation" ? "條件" : "價格"}<input required type={planForm.field === "invalidation" ? "text" : "number"} min={planForm.field === "invalidation" ? undefined : "0"} step="any" value={planForm.value} onChange={(event) => setPlanForm({ ...planForm, value: event.target.value })}/></label><label>生效時間<input required type="datetime-local" value={planForm.effectiveAt} onChange={(event) => setPlanForm({ ...planForm, effectiveAt: event.target.value })}/></label><label>理由<input value={planForm.reason} placeholder="支撐、型態或規則依據" onChange={(event) => setPlanForm({ ...planForm, reason: event.target.value })}/></label><button className="primary" type="submit">加入時間線</button></form>}
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
  return <article className="behavior-chart"><div><b>{title}</b><small>{subtitle}・{points.length} 筆可追溯樣本</small></div>{points.length ? <div className="scatter-stage"><span className="axis-x">{xLabel}</span><span className="axis-y">{yLabel}</span><i className="zero-x" style={{ bottom: `${clamp((0 - yMin) / yRange) * 100}%` }}/><i className="zero-y" style={{ left: `${clamp((0 - xMin) / xRange) * 100}%` }}/>{points.map((point) => <button type="button" key={point.cycleId} tabIndex={-1} aria-label={`${point.symbol}：${xLabel} ${pct(xValue(point))}，${yLabel} ${pct(yValue(point))}`} className={`scatter-point ${String(point.category || "").toLowerCase()}`} style={{ left: `${clamp((xValue(point) - xMin) / xRange) * 94 + 3}%`, bottom: `${clamp((yValue(point) - yMin) / yRange) * 88 + 6}%` }} title={`${point.symbol}：${xLabel} ${pct(xValue(point))}，${yLabel} ${pct(yValue(point))}`} onClick={() => onSelect(point.cycleId)}><span className="sr-only">{point.symbol}</span></button>)}</div> : <div className="mini-empty">這個期間尚無可顯示的行情樣本。</div>}{points.length > 0 && <details className="chart-data-list"><summary>檢視 {points.length} 筆樣本明細與證據</summary><div className="table-wrap" tabIndex={0} role="region" aria-label={title + "樣本明細"}><table><thead><tr><th>標的</th><th>{xLabel}</th><th>{yLabel}</th><th>證據</th></tr></thead><tbody>{points.map((point) => <tr key={point.cycleId}><td>{point.symbol}</td><td>{pct(xValue(point))}</td><td>{pct(yValue(point))}</td><td><button type="button" className="text-button" onClick={() => onSelect(point.cycleId)}>查看 {point.symbol} 閉環</button></td></tr>)}</tbody></table></div></details>}</article>;
}

function QualitySummaryCard({ kind, title, scoreValue, sampleRate, metrics, weakest, onSelect }: { kind: "entry" | "exit"; title: string; scoreValue: number | null; sampleRate: number | null; metrics: { label: string; value: string; note: string }[]; weakest: any[]; onSelect: (cycleId: string) => void }) {
  return <article className={`quality-summary-card ${kind}`}><div className="quality-card-head"><div><span>客觀價格旁證</span><h2>{title}</h2></div><div className={`quality-score ${scoreTone(scoreValue)}`}><b>{score(scoreValue)}</b><small>/100</small></div></div><div className="quality-verdict"><b>{scoreValue == null ? "行情不足" : scoreValue >= 0.7 ? "整體位置良好" : scoreValue >= 0.4 ? "整體位置普通" : "整體需要改善"}</b><span>位置良好比例 {pct(sampleRate)}</span></div><div className="quality-metrics">{metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><b>{metric.value}</b><small>{metric.note}</small></div>)}</div><div className="quality-watchlist"><div><b>優先回顧</b><span>位置分數最低的交易</span></div>{weakest.length ? weakest.map((trade) => <button type="button" key={trade.cycleId} onClick={() => onSelect(trade.cycleId)}><span><b>{trade.symbol}</b><small>{trade.openDate} → {trade.closeDate}</small></span><strong>{score(kind === "entry" ? trade.entryScore : trade.exitScore)}</strong></button>) : <small>尚無足夠行情樣本</small>}</div></article>;
}

function periodLabel(scope: string, period: string) {
  if (scope === "year") return `${period}年`;
  if (scope === "month") return `${period.slice(0, 4)}年${period.slice(5)}月`;
  if (scope === "week") return `${period} 當週`;
  return "總累計";
}

function ExpectancyHeatmap({ stats, label }: { stats: any; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const winRatePct = stats.winRate == null ? null : stats.winRate * 100;
  const rewardRisk = stats.rewardRisk;
  const inRange = winRatePct != null && rewardRisk != null && winRatePct >= 10 && winRatePct <= 80 && rewardRisk >= 0.2 && rewardRisk <= 5;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const width = Math.max(760, canvas.parentElement?.clientWidth || 760);
      const dpr = window.devicePixelRatio || 1;
      const margin = { left: 72, right: 18, top: 48, bottom: 38 };
      const columns = 36;
      const rows = 49;
      const cellWidth = (width - margin.left - margin.right) / columns;
      const cellHeight = 15;
      const height = margin.top + rows * cellHeight + margin.bottom;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = themedContext(canvas);
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const expectancy = (rate: number, ratio: number) => (rate / 100) * ratio - (1 - rate / 100);
      const color = (value: number) => {
        if (Math.abs(value) < 0.025) return "#343c49";
        if (value < 0) return `hsl(355 72% ${88 - 52 * Math.min(1, Math.abs(value) / 0.58)}%)`;
        return `hsl(126 69% ${88 - 58 * Math.pow(Math.min(1, value / 2.6), 0.72)}%)`;
      };
      context.fillStyle = "#e1e6ef";
      context.font = "700 12px system-ui";
      context.textAlign = "center";
      context.fillText("獲利交易率", margin.left + columns * cellWidth / 2, 15);
      for (let column = 0; column < columns; column += 1) {
        const rate = 10 + column * 2;
        if (rate % 10 === 0) context.fillText(`${rate}%`, margin.left + (column + 0.5) * cellWidth, 36);
      }
      context.save();
      context.translate(15, margin.top + rows * cellHeight / 2);
      context.rotate(-Math.PI / 2);
      context.fillText("平均獲利率 ÷ 平均虧損率", 0, 0);
      context.restore();
      for (let row = 0; row < rows; row += 1) {
        const ratio = Number((0.2 + row * 0.1).toFixed(1));
        const y = margin.top + row * cellHeight;
        if (ratio === 0.2 || Math.round(ratio * 10) % 5 === 0) {
          context.fillStyle = "#52605a";
          context.font = "12px system-ui";
          context.textAlign = "right";
          context.fillText(ratio.toFixed(1), margin.left - 8, y + 11);
        }
        for (let column = 0; column < columns; column += 1) {
          const rate = 10 + column * 2;
          const x = margin.left + column * cellWidth;
          context.fillStyle = color(expectancy(rate, ratio));
          context.fillRect(x, y, cellWidth, cellHeight);
          context.strokeStyle = "rgba(255,255,255,.65)";
          context.lineWidth = 0.65;
          context.strokeRect(x, y, cellWidth, cellHeight);
        }
      }
      context.beginPath();
      let started = false;
      for (let rate = 10; rate <= 80; rate += 0.5) {
        const ratio = (1 - rate / 100) / (rate / 100);
        if (ratio < 0.2 || ratio > 5) continue;
        const x = margin.left + ((rate - 10) / 2 + 0.5) * cellWidth;
        const y = margin.top + ((ratio - 0.2) / 0.1 + 0.5) * cellHeight;
        if (!started) { context.moveTo(x, y); started = true; } else context.lineTo(x, y);
      }
      context.strokeStyle = "#111";
      context.lineWidth = 2.4;
      context.lineJoin = "round";
      context.stroke();
      if (inRange) {
        const x = margin.left + ((winRatePct - 10) / 2 + 0.5) * cellWidth;
        const y = margin.top + ((rewardRisk - 0.2) / 0.1 + 0.5) * cellHeight;
        context.beginPath();
        context.arc(x, y, 8, 0, Math.PI * 2);
        context.fillStyle = "#f7c948";
        context.fill();
        context.strokeStyle = "#111";
        context.lineWidth = 3;
        context.stroke();
        context.fillStyle = "#111";
        context.font = "800 12px system-ui";
        context.textAlign = x > width - 170 ? "right" : "left";
        context.fillText("你的區間結果", x + (x > width - 170 ? -12 : 12), Math.max(14, y - 10));
      }
      context.strokeStyle = "#84908a";
      context.lineWidth = 1;
      context.strokeRect(margin.left, margin.top, columns * cellWidth, rows * cellHeight);
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas.parentElement || canvas);
    draw();
    const themeObserver = observeChartTheme(draw);
    return () => { observer.disconnect(); themeObserver.disconnect(); };
  }, [inRange, rewardRisk, winRatePct]);

  const hasSample = stats.winners.count > 0 && stats.losers.count > 0;
  return <section className="expectancy-map"><div className="expectancy-map-head"><div><h2>勝率與風報比期望值</h2><p>每格為 2% 勝率 × 0.1 風報比；黑線是損益兩平，黃色圓點是目前選定區間。</p></div><div className="expectancy-result"><span>{label}</span><b>{winRatePct == null ? "—" : `${winRatePct.toFixed(1)}%`} × {rewardRisk == null ? "—" : rewardRisk.toFixed(2)}</b><small>{stats.expectancyR == null ? "需要同時有獲利與虧損樣本" : `每筆期望值 ${stats.expectancyR >= 0 ? "+" : ""}${stats.expectancyR.toFixed(2)}R`}</small></div></div><div className="expectancy-canvas-wrap" tabIndex={0} role="region" aria-label="期望值圖表，可橫向捲動"><canvas ref={canvasRef} role="img" aria-label={`${label}的勝率與平均盈虧比期望值熱圖`}/></div><div className="expectancy-legend"><span>強負期望</span><i className="negative-strong"/><i className="negative-light"/><i className="neutral"/><i className="positive-light"/><i className="positive-strong"/><span>強正期望</span><b/><span>損益兩平</span></div>{!hasSample && <small className="expectancy-note">此區間必須至少各有一筆獲利與虧損交易，才能計算風報比與定位。</small>}{hasSample && !inRange && <small className="expectancy-note">目前結果超出圖表範圍（勝率 10%–80%、盈虧比 0.2–5），保留實際數值但不將標記壓在線框邊緣。</small>}</section>;
}

function ProfitLossAnalysis({ stats, scope, period }: { stats: ReturnType<typeof buildProfitLossTradeStats>; scope: string; period: string }) {
  const groups = [{ key: "profit", title: "總獲利單", tone: "positive", data: stats.winners }, { key: "loss", title: "總虧損單", tone: "negative", data: stats.losers }];
  return <><section className="profit-loss-analysis"><div className="analysis-head"><div><h2>盈虧交易結構</h2><p>依出場日期分組；平均投入持倉金額為每個閉環的總進場成交金額，全部換算為美元等值。</p></div><strong className="analysis-sample">{periodLabel(scope, period)}・{stats.cycles.length} 筆</strong></div><div className="edge-summary"><div><span>我的勝率</span><b>{stats.winRate == null ? "—" : `${(stats.winRate * 100).toFixed(1)}%`}</b><small>獲利 ÷ 獲利與虧損交易</small></div><div><span>我的風報比</span><b>{stats.rewardRisk == null ? "—" : stats.rewardRisk.toFixed(2)}</b><small>平均獲利率 ÷ 平均虧損率</small></div><div><span>我的交易期望值</span><b className={stats.expectancyR == null ? "" : stats.expectancyR >= 0 ? "positive" : "negative"}>{stats.expectancyR == null ? "—" : `${stats.expectancyR >= 0 ? "+" : ""}${stats.expectancyR.toFixed(2)}R`}</b><small>每筆交易的期望 R 值</small></div></div><div className="profit-loss-groups">{groups.map((group) => <article key={group.key} className={`profit-loss-group ${group.key}`}><div><span>{group.title}</span><b className={group.tone}>{group.data.count} 筆</b></div><dl><div><dt>交易單數</dt><dd>{group.data.count}</dd><small>已平倉交易閉環</small></div><div><dt>{group.key === "profit" ? "平均獲利率" : "平均虧損率"}</dt><dd className={group.tone}>{pct(group.data.averageReturn)}</dd><small>交易報酬率算術平均</small></div><div><dt>{group.key === "profit" ? "平均獲利金額" : "平均虧損金額"}</dt><dd className={group.tone}>{money(group.data.averagePnlUsd, "USD")}</dd><small>{group.data.missingFx ? "缺少USDTWD，不推測" : "美元等值"}</small></div><div><dt>平均投入持倉金額</dt><dd>{money(group.data.averageEntryNotionalUsd, "USD")}</dd><small>總進場成交金額平均</small></div></dl></article>)}</div>{stats.flatCount > 0 && <small className="analysis-flat-note">另有 {stats.flatCount} 筆損益兩平交易，未納入獲利或虧損組。</small>}</section></>;
}

function MonthlyExpectancyTrend({ cycles }: { cycles: any[] }) {
  const trend = useMemo(() => buildMonthlyExpectancyTrend(cycles), [cycles]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visibleCount, setVisibleCount] = useState(Math.max(3, trend.length));
  const [expanded, setExpanded] = useState(true);
  const [endIndex, setEndIndex] = useState(Math.max(0, trend.length - 1));
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, trend.length - 1));
  // Preserve the existing viewport reset when the strategy sample changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setVisibleCount(Math.max(3, trend.length)); setEndIndex(Math.max(0, trend.length - 1)); setSelectedIndex(Math.max(0, trend.length - 1)); }, [trend.length]);
  const count = Math.min(Math.max(3, visibleCount), Math.max(3, trend.length));
  const startIndex = Math.max(0, endIndex - count + 1);
  const visible = trend.slice(startIndex, endIndex + 1);
  const selected = trend[selectedIndex] || null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const width = Math.max(760, canvas.parentElement?.clientWidth || 760);
      const dpr = window.devicePixelRatio || 1;
      const margin = { left: 70, right: 20, top: 20, bottom: 35 };
      const panelHeight = 128;
      const panelGap = 18;
      const height = margin.top + panelHeight * 3 + panelGap * 2 + margin.bottom;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      const context = themedContext(canvas); if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height);
      const plotWidth = width - margin.left - margin.right;
      const x = (index: number) => margin.left + (visible.length <= 1 ? plotWidth / 2 : index * plotWidth / (visible.length - 1));
      const series = [
        { key: "winRate", label: "月勝率", color: "#69c6a7", format: (value: number) => `${(value * 100).toFixed(0)}%`, fixed: [0, 1] },
        { key: "rewardRisk", label: "平均盈虧比", color: "#d68b32", format: (value: number) => value.toFixed(2) },
        { key: "expectancyR", label: "交易期望值", color: "#765caa", format: (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`, zero: true },
      ];
      series.forEach((definition: any, panel: number) => {
        const top = margin.top + panel * (panelHeight + panelGap);
        const values = visible.map((point: any) => point[definition.key]).filter(Number.isFinite);
        let minimum = definition.fixed?.[0] ?? Math.min(...values, 0);
        let maximum = definition.fixed?.[1] ?? Math.max(...values, 1);
        if (minimum === maximum) { minimum -= 0.5; maximum += 0.5; }
        const padding = definition.fixed ? 0 : (maximum - minimum) * 0.1;
        minimum -= padding; maximum += padding;
        const y = (value: number) => top + panelHeight - (value - minimum) / (maximum - minimum) * panelHeight;
        context.fillStyle = "#e1e6ef"; context.font = "700 12px system-ui"; context.textAlign = "left";
        context.fillText(definition.label, 6, top + 13);
        context.strokeStyle = "#d8dcd7"; context.lineWidth = 1;
        for (let tick = 0; tick <= 2; tick += 1) {
          const value = minimum + (maximum - minimum) * tick / 2;
          const tickY = y(value);
          context.beginPath(); context.moveTo(margin.left, tickY); context.lineTo(width - margin.right, tickY); context.stroke();
          context.fillStyle = "#65716c"; context.font = "12px system-ui"; context.textAlign = "right";
          context.fillText(definition.format(value), margin.left - 7, tickY + 3);
        }
        if (definition.zero && minimum < 0 && maximum > 0) {
          context.strokeStyle = "#555"; context.setLineDash([4, 4]); context.beginPath(); context.moveTo(margin.left, y(0)); context.lineTo(width - margin.right, y(0)); context.stroke(); context.setLineDash([]);
        }
        context.strokeStyle = definition.color; context.lineWidth = 2.5; context.lineJoin = "round";
        let drawing = false; context.beginPath();
        visible.forEach((point: any, index: number) => {
          const value = point[definition.key];
          if (!Number.isFinite(value)) { drawing = false; return; }
          if (!drawing) { context.moveTo(x(index), y(value)); drawing = true; } else context.lineTo(x(index), y(value));
        });
        context.stroke();
        visible.forEach((point: any, index: number) => {
          const value = point[definition.key]; if (!Number.isFinite(value)) return;
          context.beginPath(); context.arc(x(index), y(value), startIndex + index === selectedIndex ? 5 : 3, 0, Math.PI * 2);
          context.fillStyle = startIndex + index === selectedIndex ? "#f7c948" : definition.color; context.fill();
          if (startIndex + index === selectedIndex) { context.strokeStyle = "#111"; context.lineWidth = 1.5; context.stroke(); }
        });
        context.strokeStyle = "#aeb6b1"; context.lineWidth = 1; context.strokeRect(margin.left, top, plotWidth, panelHeight);
      });
      const labelEvery = visible.length > 18 ? 3 : visible.length > 10 ? 2 : 1;
      context.fillStyle = "#52605a"; context.font = "12px system-ui"; context.textAlign = "center";
      visible.forEach((point: any, index: number) => { if (index % labelEvery === 0 || index === visible.length - 1) context.fillText(point.month, x(index), height - 13); });
    };
    const observer = new ResizeObserver(draw); observer.observe(canvas.parentElement || canvas); draw();
    const themeObserver = observeChartTheme(draw);
    return () => { observer.disconnect(); themeObserver.disconnect(); };
  }, [endIndex, selectedIndex, startIndex, visible]);

  const selectFromPointer = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!visible.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const relative = Math.max(0, Math.min(1, (event.clientX - rect.left - 70) / Math.max(1, rect.width - 90)));
    setSelectedIndex(startIndex + Math.round(relative * (visible.length - 1)));
  };
  const zoom = (direction: number) => setVisibleCount((value) => Math.max(3, Math.min(Math.max(3, trend.length), value + direction)));
  return <section className="monthly-trend"><button type="button" className="monthly-trend-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><span><b>全時段交易優勢曲線</b></span><strong>{expanded ? "收合 ▲" : "展開 ▼"}</strong></button>{expanded && <div className="monthly-trend-body"><div className="monthly-trend-head"><div><h2>完整月份走勢</h2><p>預設呈現全部交易月份；依每月出場閉環自動更新，三項指標使用獨立縱軸刻度。</p></div><div className="trend-controls"><button type="button" onClick={() => zoom(-3)} disabled={count <= 3}>＋ 放大</button><button type="button" onClick={() => zoom(3)} disabled={count >= trend.length}>－ 縮小</button><button type="button" aria-label="往前移動月份" onClick={() => setEndIndex((value) => Math.max(count - 1, value - 1))} disabled={startIndex === 0}>←</button><button type="button" aria-label="往後移動月份" onClick={() => setEndIndex((value) => Math.min(trend.length - 1, value + 1))} disabled={endIndex >= trend.length - 1}>→</button><strong>{visible[0]?.month || "—"} → {visible.at(-1)?.month || "—"}</strong></div></div>{trend.length ? <><div className="monthly-trend-canvas" tabIndex={0} role="region" aria-label="全時段曲線，可橫向捲動"><canvas ref={canvasRef} onMouseMove={selectFromPointer} onClick={selectFromPointer} role="img" aria-label="月勝率、平均盈虧比與交易期望值連續曲線"/></div><label className="trend-month-picker">檢視月份<select value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))}>{trend.map((point: any, index: number) => <option key={point.month} value={index}>{point.month}</option>)}</select></label><div className="monthly-trend-detail" aria-live="polite"><b>{selected?.month || "—"}</b><span>閉環 {selected?.sampleCount ?? 0} 筆</span><span>勝率 {selected?.winRate == null ? "—" : `${(selected.winRate * 100).toFixed(1)}%`}</span><span>平均盈虧比 {selected?.rewardRisk == null ? "—" : selected.rewardRisk.toFixed(2)}</span><span>期望值 {selected?.expectancyR == null ? "—" : `${selected.expectancyR >= 0 ? "+" : ""}${selected.expectancyR.toFixed(2)}R`}</span></div></> : <div className="mini-empty">尚無可計算的已平倉月份。</div>}<small className="monthly-trend-note">當月必須同時有獲利與虧損交易，才能計算平均盈虧比與期望值；缺少的月份會保留時間位置但中斷曲線。</small></div>}</section>;
}

function StrategyAnalysisPanel({ cycles, strategies, assignments, fxRate, strategyId, versionId, onSelectCycle }: { cycles: any[]; strategies: any[]; assignments: Record<string, any>; fxRate: number | null; strategyId: string; versionId: string; onSelectCycle: (cycleId: string) => void }) {
  const analysis = useMemo(() => buildStrategyAnalysis(cycles, strategies, assignments, { strategyId, versionId, usdTwdRate: fxRate }), [assignments, cycles, fxRate, strategies, strategyId, versionId]);
  const formatPct = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
  const cohort = (title: string, value: any) => <article><h3>{title}</h3><div><span>交易數</span><b>{value.count}</b></div><div><span>勝率</span><b>{formatPct(value.winRate)}</b></div><div><span>平均盈虧比</span><b>{value.rewardRisk?.toFixed(2) || "—"}</b></div><div><span>期望值</span><b>{value.expectancyR == null ? "—" : `${value.expectancyR.toFixed(2)}R`}</b></div><div><span>平均投入</span><b>{money(value.averageEntryNotionalUsd)}</b></div><div><span>已實現損益</span><b className={value.totalPnlUsd == null ? "" : value.totalPnlUsd >= 0 ? "positive" : "negative"}>{money(value.totalPnlUsd)}</b></div></article>;
  return <section className="strategy-analysis"><div className="panel-head"><div><h2>策略遵守與違規比較</h2><p>違規損益僅為觀察結果，不推論全部損失由違規造成。</p></div><span className={`status ${analysis.sampleState === "ESTABLISHED" ? "ok" : "warn"}`}>{analysis.sampleState === "ESTABLISHED" ? `${analysis.reviewedTradeCount} 筆已稽核` : `${analysis.reviewedTradeCount}/20・待觀察`}</span></div><div className="strategy-metrics"><div><span>策略交易</span><b>{analysis.total.count}</b></div><div><span>稽核覆蓋率</span><b>{formatPct(analysis.reviewCoverage)}</b></div><div><span>規則遵守率</span><b>{formatPct(analysis.adherenceRate)}</b></div><div><span>完全遵守交易率</span><b>{formatPct(analysis.fullComplianceRate)}</b></div><div><span>策略勝率</span><b>{formatPct(analysis.total.winRate)}</b></div><div><span>平均盈虧比</span><b>{analysis.total.rewardRisk?.toFixed(2) || "—"}</b></div><div><span>期望值</span><b>{analysis.total.expectancyR == null ? "—" : `${analysis.total.expectancyR.toFixed(2)}R`}</b></div><div><span>已實現損益</span><b>{money(analysis.total.totalPnlUsd)}</b></div></div>{analysis.total.count ? <><div className="strategy-cohorts">{cohort("完全遵守交易", analysis.compliant)}{cohort("含違規交易", analysis.violated)}</div><div className="table-wrap" tabIndex={0} role="region" aria-label="分析資料表，可捲動"><table><thead><tr><th>規則</th><th>群組</th><th>適用樣本</th><th>遵守率</th><th>違反</th><th>違規交易損益</th><th>證據閉環</th></tr></thead><tbody>{analysis.rules.map((rule: any) => <tr key={rule.key}><td><b>{rule.ruleName}</b><small>{rule.strategyName}</small></td><td>{rule.group === "MARKET_CONDITION" ? "市場" : rule.group === "ENTRY_TRIGGER" ? "進場" : "出場"}</td><td>{rule.applicableCount}</td><td>{formatPct(rule.adherenceRate)}</td><td className={rule.violationCount ? "negative" : ""}>{rule.violationCount}</td><td className={rule.violationPnlUsd == null ? "" : rule.violationPnlUsd >= 0 ? "positive" : "negative"}>{money(rule.violationPnlUsd)}</td><td><div className="evidence-links">{rule.evidenceCycleIds.slice(0, 5).map((cycleId: string) => <button key={cycleId} type="button" className="text-button" onClick={() => onSelectCycle(cycleId)}>{cycles.find((cycle) => cycle.id === cycleId)?.symbol || "閉環"}</button>)}</div></td></tr>)}</tbody></table></div></> : <div className="mini-empty">這個資料區間尚無已指派策略的交易。</div>}</section>;
}

function QualityDistributionCard({ group, cycles, onSelectCycle }: { group: any; cycles: any[]; onSelectCycle: (cycleId: string) => void }) {
  const cycleName = (cycleId: string) => cycles.find((cycle) => cycle.id === cycleId)?.symbol || "閉環";
  return <article className={`quality-distribution-card ${String(group.id).toLowerCase()}`}>
    <div className="quality-distribution-head"><div><h3>{group.title}</h3><small>比例只計入已評分交易</small></div><span className={`status ${group.sampleState === "ESTABLISHED" ? "ok" : "warn"}`}>{group.sampleState === "ESTABLISHED" ? "樣本已建立" : `${group.ratedCount}/20・待觀察`}</span></div>
    <div className="quality-distribution-stats"><span>適用 <b>{group.applicableCount}</b></span><span>已評 <b>{group.ratedCount}</b></span><span>待評 <b>{group.pendingCount}</b></span><span>覆蓋 <b>{plainPct(group.coverage)}</b></span></div>
    <div className="quality-distribution-items">{group.items.map((item: any) => <div key={item.value} className={`quality-distribution-row ${String(item.value).toLowerCase()}`}>
      <div><span><b>{item.label}</b><small>{item.description}</small></span><strong>{item.count} 筆・{item.percentage == null ? "—" : `${item.percentage.toFixed(1)}%`}</strong></div>
      <i><span style={{ width: `${(item.rate || 0) * 100}%` }}/></i>
      {item.cycleIds.length > 0 && <details className="quality-distribution-evidence-list"><summary>查看 {item.count} 筆證據閉環</summary><div className="quality-distribution-evidence">{item.cycleIds.map((cycleId: string) => <button type="button" key={cycleId} onClick={() => onSelectCycle(cycleId)}>{cycleName(cycleId)}・{cycles.find((cycle) => cycle.id === cycleId)?.closeAt?.slice(0, 10)}</button>)}</div></details>}
    </div>)}</div>
  </article>;
}

function QualityTagDistribution({ analysis, cycles, onSelectCycle }: { analysis: any; cycles: any[]; onSelectCycle: (cycleId: string) => void }) {
  return <section className="quality-tag-distribution"><div className="panel-head"><div><h2>交易品質標籤分布</h2><p>人工單選是主要評分結論；點擊標的可回到原始閉環、K 線與回顧證據。</p></div><div className="quality-rating-total"><span>進出場皆完成</span><b>{analysis.fullyRatedCount}/{analysis.total}</b><small>完整覆蓋率 {plainPct(analysis.completeCoverage)}</small></div></div><div className="quality-distribution-grid"><QualityDistributionCard group={analysis.entry} cycles={cycles} onSelectCycle={onSelectCycle}/><QualityDistributionCard group={analysis.profitExit} cycles={cycles} onSelectCycle={onSelectCycle}/><QualityDistributionCard group={analysis.stopExit} cycles={cycles} onSelectCycle={onSelectCycle}/></div></section>;
}

export function TrainingWorkspace({ entryContexts = {}, cycles, marketBars, reviews, fxRate, strategies = [], strategyAssignments = {}, onSelectCycle, onQualityRatingChange }: { entryContexts?: Record<string, any>; cycles: any[]; marketBars: any[]; reviews: Record<string, any>; fxRate: number | null; strategies?: any[]; strategyAssignments?: Record<string, any>; onSelectCycle: (cycleId: string) => void; onQualityRatingChange: (cycleId: string, field: "entryQualityTag" | "exitQualityTag", value: string) => void }) {
  const [scope, setScope] = useState("all");
  const [strategyId, setStrategyId] = useState("");
  const [versionId, setVersionId] = useState("");
  const strategy = strategies.find((item) => item.id === strategyId);
  const strategyOnlyCycles = useMemo(() => cycles.filter((cycle) => { const assignment = strategyAssignments[cycle.id]; return (!strategyId || assignment?.strategyId === strategyId) && (!versionId || assignment?.strategyVersionId === versionId); }), [cycles, strategyAssignments, strategyId, versionId]);
  const options = useMemo(() => scope === "all" ? [] : [...new Set(strategyOnlyCycles.map((cycle) => cycleAnalysisPeriod(cycle, scope)))].sort().reverse(), [scope, strategyOnlyCycles]);
  const [period, setPeriod] = useState("");
  // Preserve the existing default period on scope/strategy changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPeriod(scope === "all" ? "" : options[0] || ""); }, [options, scope]);
  const [sampleLimit, setSampleLimit] = useState("0");
  const [entrySetup, setEntrySetup] = useState("");
  const [volumeTag, setVolumeTag] = useState("");
  const [hasAdd, setHasAdd] = useState("");
  const strategyFilteredCycles = useMemo(() => filterCyclesByEntry(strategyOnlyCycles, entryContexts, entrySetup, volumeTag, hasAdd), [strategyOnlyCycles, entryContexts, entrySetup, volumeTag, hasAdd]);
  const scopedCycles = useMemo(() => strategyFilteredCycles.filter((cycle: any) => scope === "all" || cycleAnalysisPeriod(cycle, scope) === period), [period, scope, strategyFilteredCycles]);
  const periodCycles = useMemo(() => filterCyclesByPeriod(scopedCycles, "", "", Number(sampleLimit)), [sampleLimit, scopedCycles]);
  const quality = useMemo(() => buildTradeQualityAnalysis(periodCycles, marketBars, reviews), [marketBars, periodCycles, reviews]);
  const matrices = useMemo(() => buildBehaviorDashboard(periodCycles, marketBars, reviews, [], []), [marketBars, periodCycles, reviews]);
  const profitLossStats = useMemo(() => buildProfitLossTradeStats(periodCycles, scope, period, fxRate), [periodCycles, fxRate, period, scope]);
  const summary = quality.summary;
  return <div className="training-workspace quality-workspace">
    <section className="quality-intro"><div><h2>交易品質標籤評分</h2><p>以人工單選標籤記錄真正的交易判斷；價格位置、MAE、MFE 與出場後走勢保留為可回溯的客觀旁證。</p></div><div className="quality-coverage"><a className="primary" href="#quick-rating">前往快速評分 ↓</a><span>已分析閉環 <b>{summary.total}</b></span><span>進出場皆完成 <b>{quality.tagAnalysis.fullyRatedCount}/{summary.total}</b></span><span>完整覆蓋率 <b>{plainPct(quality.tagAnalysis.completeCoverage)}</b></span></div></section>
    <section className="strategy-analysis-filters" aria-label="交易分析篩選"><div className="analysis-period-controls"><label>資料區間<select value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">總累計</option><option value="year">年區間</option><option value="month">月區間</option><option value="week">週區間</option></select></label>{scope !== "all" && <label>選擇期間<select value={period} onChange={(event) => setPeriod(event.target.value)}>{options.map((option) => <option key={option} value={option}>{periodLabel(scope, option)}</option>)}</select></label>}<strong>{periodLabel(scope, period)}・{periodCycles.length} 筆</strong></div><label>策略<select value={strategyId} onChange={(event) => { setStrategyId(event.target.value); setVersionId(""); }}><option value="">全部策略與未指派交易</option>{strategies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>版本<select value={versionId} disabled={!strategyId} onChange={(event) => setVersionId(event.target.value)}><option value="">全部版本</option>{(strategy?.versions || []).map((version: any) => <option key={version.id} value={version.id}>v{version.version}・{version.changeReason}</option>)}</select></label><label>呈現筆數<select value={sampleLimit} onChange={(event) => setSampleLimit(event.target.value)}><option value="0">全部</option><option value="10">最新 10 筆</option><option value="25">最新 25 筆</option><option value="50">最新 50 筆</option></select></label><small>下方區間統計與評分共用此篩選；全時段曲線另標示範圍。</small></section>
    <section className="strategy-analysis-filters" aria-label="成交登錄證據篩選"><label>進場型態<select value={entrySetup} onChange={(event)=>setEntrySetup(event.target.value)}><option value="">全部</option>{ENTRY_OPTIONS.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>量價標籤<select value={volumeTag} onChange={(event)=>setVolumeTag(event.target.value)}><option value="">全部</option>{VOLUME_OPTIONS.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>加碼紀錄<select value={hasAdd} onChange={(event)=>setHasAdd(event.target.value)}><option value="">全部（含未登錄）</option><option value="yes">有加碼登錄</option><option value="no">已登錄且無加碼紀錄</option></select></label><span>{periodCycles.length} 個閉環・{periodCycles.reduce((sum:number,cycle:any)=>sum+contextsForCycle(entryContexts,cycle.id).length,0)} 次已登錄操作</span><small>一個閉環只計一次交易；未勾選不代表條件不成立。加碼篩選只使用已保存的登錄證據。</small></section>
    <SectionLinks label="交易行為分析區段" links={[{id:"quality-rating",label:"品質評分"},{id:"performance-structure",label:"績效結構"},{id:"strategy-audit",label:"規則稽核"},{id:"price-evidence",label:"價格旁證"}]}/>
    <section className="analysis-section" id="quality-rating" tabIndex={-1}>
    <QualityTagDistribution analysis={quality.tagAnalysis} cycles={periodCycles} onSelectCycle={onSelectCycle}/>
    <section className="quality-ledger" id="quick-rating" tabIndex={-1}><div className="panel-head"><div><h2>逐筆交易品質快速評分</h2></div><span className="muted">選擇後立即同步閉環詳情與背景自動儲存</span></div>{quality.trades.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label="分析資料表，可捲動"><table className="quality-rating-table"><thead><tr><th>閉環</th><th>買入點標籤</th><th>離場點標籤</th><th>進場位置旁證</th><th>進場後3日</th><th>MAE</th><th>出場位置旁證</th><th>MFE留存</th><th>出場後5日</th><th>回顧證據</th><th>K線</th></tr></thead><tbody>{[...quality.trades].sort((a, b) => b.closeDate.localeCompare(a.closeDate)).map((trade) => <tr key={trade.cycleId}><td><b>{trade.symbol}</b><small>{trade.direction === "SHORT" ? "空" : "多"}・{trade.openDate} → {trade.closeDate}</small></td><td><QualityTagPicker cycle={trade} kind="entry" compact value={trade.entryQualityTag} onChange={(value) => onQualityRatingChange(trade.cycleId, "entryQualityTag", value)}/></td><td><QualityTagPicker cycle={trade} kind="exit" compact value={trade.exitQualityTag} onChange={(value) => onQualityRatingChange(trade.cycleId, "exitQualityTag", value)}/></td><td><span className={`quality-pill ${scoreTone(trade.entryScore)}`}>{score(trade.entryScore)}分</span><small>{trade.entryLabel}</small></td><td className={trade.entryFollowThrough3 != null && trade.entryFollowThrough3 >= 0 ? "positive" : "negative"}>{pct(trade.entryFollowThrough3)}</td><td className={trade.maePct != null && trade.maePct < -0.1 ? "negative" : ""}>{pct(trade.maePct)}</td><td><span className={`quality-pill ${scoreTone(trade.exitScore)}`}>{score(trade.exitScore)}分</span><small>{trade.exitLabel}</small></td><td>{pct(trade.mfeRetention)}</td><td className={trade.postExit5 != null && trade.postExit5 > 0.03 ? "negative" : ""}>{pct(trade.postExit5)}</td><td className="review-cell"><span className={`review-state ${trade.entryReviewed && trade.exitReviewed ? "done" : "pending"}`}>{trade.entryReviewed && trade.exitReviewed ? "已補充" : "待補"}</span><small title={`${trade.entryReview || ""} ${trade.exitReview || ""}`}>{trade.entryReview || trade.exitReview || "閉環內尚未填寫判定與改善說明"}</small></td><td><button type="button" className="ghost" aria-label={`查看 ${trade.symbol} ${trade.closeDate} 的K線與回顧`} onClick={() => onSelectCycle(trade.cycleId)}>看K線與回顧</button></td></tr>)}</tbody></table></div> : <div className="mini-empty">這個期間尚無完整交易閉環可分析。</div>}<div className="quality-method"><b>主要結論</b><span>人工標籤由使用者依原計畫、策略與 K 線證據判定。舊資料不推測；未評交易不納入比例分母，仍計入待評與覆蓋率。</span></div></section>
    </section>
    <section className="analysis-section" id="performance-structure" tabIndex={-1}>
    <ProfitLossAnalysis stats={profitLossStats} scope={scope} period={period}/>
      <p className="section-note">全時段曲線依策略、版本及成交登錄證據篩選；不套用上方資料區間或呈現筆數。</p>
    <MonthlyExpectancyTrend cycles={strategyFilteredCycles}/>
    </section>
    <section className="analysis-section" id="strategy-audit" tabIndex={-1}>
    <StrategyAnalysisPanel cycles={periodCycles} strategies={strategies} assignments={strategyAssignments} fxRate={fxRate} strategyId={strategyId} versionId={versionId} onSelectCycle={onSelectCycle}/>
    </section>
    <section className="analysis-section" id="price-evidence" tabIndex={-1}>
    <ExpectancyHeatmap stats={profitLossStats} label={periodLabel(scope, period)}/>
    <section className="matrix-section"><div className="matrix-head"><div><h2>MFE 留存與 MAE 報酬矩陣</h2><p>與盈虧交易結構使用相同資料區間；點選樣本直接回到原始閉環 K 線。</p></div><div className="matrix-filters"><strong>{periodLabel(scope, period)}・顯示 {periodCycles.length}／{scopedCycles.length} 筆</strong></div></div><div className="behavior-grid"><ScatterPlot title="MFE 留存矩陣" subtitle="辨識高浮盈回吐與高留存出場" points={matrices.retention} xValue={(point) => point.mfePct} yValue={(point) => point.retention} xLabel="MFE" yLabel="留存率" onSelect={onSelectCycle}/><ScatterPlot title="MAE 報酬矩陣" subtitle="辨識深度套牢與有效風控" points={matrices.maeReturn} xValue={(point) => point.maePct} yValue={(point) => point.returnPct} xLabel="MAE" yLabel="實際報酬" onSelect={onSelectCycle}/></div></section>
    <details className="objective-evidence"><summary><span><b>客觀價格旁證</b></span><strong>展開 0–100 位置分數 ▼</strong></summary><div className="quality-dual-grid">
      <QualitySummaryCard kind="entry" title="買入價格位置" scoreValue={summary.averageEntryScore} sampleRate={summary.goodEntryRate} onSelect={onSelectCycle} weakest={quality.weakestEntries} metrics={[{ label: "進場後3日順向率", value: pct(summary.entryFollowThroughRate), note: "3個交易日後仍朝交易方向" }, { label: "平均最大反向波動", value: pct(summary.averageMae), note: "進場後承受的 MAE" }, { label: "完成進場回顧", value: `${summary.entryReviewedCount}/${summary.total}`, note: "已記錄買點依據與改善位置" }]}/>
      <QualitySummaryCard kind="exit" title="離場價格位置" scoreValue={summary.averageExitScore} sampleRate={summary.goodExitRate} onSelect={onSelectCycle} weakest={quality.weakestExits} metrics={[{ label: "平均MFE留存", value: pct(summary.averageMfeRetention), note: "實際報酬保留最大浮盈比例" }, { label: "偏早出場率", value: pct(summary.earlyExitRate), note: "出場後5日仍順向超過3%" }, { label: "完成出場回顧", value: `${summary.exitReviewedCount}/${summary.total}`, note: "已記錄出場理由與改善位置" }]}/>
    </div><div className="quality-method"><b>旁證算法</b><span>進場與出場價位依持有期間價格區間換算為 0–100 分。此分數不代表主要交易品質，也不會自動改寫人工標籤；日線只能做日線近似。</span></div></details>
    </section>
  </div>;
}
