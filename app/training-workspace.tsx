/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildBehaviorDashboard, buildCoachFindings, buildCycleReplay, detectBehaviorEvents, evaluateExperiment } from "@/lib/coach-engine.mjs";

function pct(value: number | null, digits = 1) { return value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`; }
function money(value: number | null, currency = "USD") { return value == null ? "—" : new Intl.NumberFormat("zh-TW", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
function clamp(value: number, minimum = 0, maximum = 1) { return Math.min(maximum, Math.max(minimum, value)); }
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
      const height = Math.max(330, rect.height);
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale);
      context.clearRect(0, 0, width, height);
      const padding = { top: 24, right: 64, bottom: 34, left: 16 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const planPrices = model.events.filter((event: any) => ["PLAN_STOP", "PLAN_TARGET"].includes(event.type) && event.price > 0).map((event: any) => Number(event.price));
      const prices = visibleCandles.flatMap((candle: any) => [candle.low, candle.high]).concat([model.averageEntry, ...planPrices]).filter((value: number) => Number.isFinite(value) && value > 0);
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

      const holding = visibleCandles.filter((candle: any) => candle.phase === "HOLDING");
      holding.forEach((candle: any) => {
        const index = visibleCandles.indexOf(candle);
        const x = xFor(index);
        const rising = candle.close >= candle.open;
        context.strokeStyle = rising ? "#176b50" : "#a8463b";
        context.fillStyle = rising ? "#70a58c" : "#d58b83";
        context.beginPath(); context.moveTo(x, yFor(candle.high)); context.lineTo(x, yFor(candle.low)); context.stroke();
        const top = yFor(Math.max(candle.open, candle.close));
        const bodyHeight = Math.max(2, Math.abs(yFor(candle.open) - yFor(candle.close)));
        context.fillRect(x - Math.max(2.5, step * 0.24), top, Math.max(5, step * 0.48), bodyHeight);
      });

      const postExit = visibleCandles.filter((candle: any) => candle.phase === "POST_EXIT");
      if (postExit.length) {
        const firstPostIndex = visibleCandles.indexOf(postExit[0]);
        const anchorIndex = Math.max(0, firstPostIndex - 1);
        context.save(); context.strokeStyle = "#8a918e"; context.lineWidth = 2; context.setLineDash([5, 5]);
        context.beginPath(); context.moveTo(xFor(anchorIndex), yFor(visibleCandles[anchorIndex].close));
        postExit.forEach((candle: any) => context.lineTo(xFor(visibleCandles.indexOf(candle)), yFor(candle.close)));
        context.stroke(); context.restore();
      }

      const holdingEnd = Math.max(0, visibleCandles.findLastIndex((candle: any) => candle.phase === "HOLDING"));
      drawDashedLine(context, xFor(0), yFor(model.averageEntry), xFor(holdingEnd), "#2f5f7c", `均價 ${model.averageEntry.toFixed(2)}`);
      const planEvents = model.events.filter((event: any) => ["PLAN_STOP", "PLAN_TARGET"].includes(event.type) && event.price > 0);
      planEvents.forEach((event: any, index: number) => {
        const startIndex = event.date ? visibleCandles.findIndex((candle: any) => candle.date >= event.date) : 0;
        if (startIndex < 0 || startIndex >= visibleCandles.length) return;
        const next = planEvents.slice(index + 1).find((candidate: any) => candidate.type === event.type && candidate.date);
        const nextIndex = next ? visibleCandles.findIndex((candle: any) => candle.date >= next.date) : -1;
        const endIndex = nextIndex > startIndex ? Math.min(visibleCandles.length - 1, nextIndex) : Math.min(visibleCandles.length - 1, holdingEnd);
        const color = event.type === "PLAN_STOP" ? "#b43f35" : "#3f8a4d";
        drawDashedLine(context, xFor(startIndex), yFor(event.price), xFor(Math.max(startIndex, endIndex)), color, `${event.legacy ? "歷史" : event.label} ${event.price.toFixed(2)}`);
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
      });

      context.fillStyle = "#66716e"; context.font = "10px Arial";
      const labelIndexes = [...new Set([0, Math.floor((visibleCandles.length - 1) / 2), visibleCandles.length - 1])];
      labelIndexes.forEach((index) => { const label = visibleCandles[index]?.date || ""; context.fillText(label.slice(5), Math.max(0, xFor(index) - 14), height - 10); });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [model, selectedEventId, visibleCandles]);

  return <canvas ref={canvasRef} className="replay-canvas" role="img" aria-label={`${model.symbol} 日線交易決策重播；包含成交、計畫、MAE、MFE及出場後路徑`}>交易決策重播圖</canvas>;
}

export function ReplayBoard({ cycle, marketBars, planHistory, review, rapidPairs, decisionLinks, onAddPlanVersion }: { cycle: any; marketBars: any[]; planHistory: any[]; review: any; rapidPairs: any[]; decisionLinks: Record<string, any>; onAddPlanVersion: (version: any) => void }) {
  const model = useMemo(() => buildCycleReplay(cycle, marketBars, planHistory, review, rapidPairs, decisionLinks), [cycle, decisionLinks, marketBars, planHistory, rapidPairs, review]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ field: "stopLoss", value: "", effectiveAt: dateInput(cycle.openAt), reason: "" });
  const replayCursor = cursor == null ? Math.max(0, model.candles.length - 1) : Math.min(cursor, Math.max(0, model.candles.length - 1));
  const cursorDate = model.candles[replayCursor]?.date || model.closeDate;
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
    onAddPlanVersion({ id: `plan-${cycle.id}-${Date.now()}`, cycleId: cycle.id, accountId: cycle.accountId, symbol: cycle.symbol, field: planForm.field, value: rawValue, reason: planForm.reason.trim(), effectiveAt: new Date(planForm.effectiveAt).toISOString(), createdAt, source: createdAt > cycle.closeAt ? "POST_HOC" : "USER" });
    setPlanForm((current) => ({ ...current, value: "", reason: "" }));
  }

  return <section className="replay-board">
    <div className="replay-head"><div><p className="eyebrow">DECISION REPLAY</p><h3>交易決策重播</h3></div><div className="replay-legend"><span><i className="entry-dot"/>建倉／加碼</span><span><i className="exit-dot"/>減碼／出場</span><span><i className="stop-line"/>停損</span><span><i className="target-line"/>停利</span><span><i className="post-line"/>出場後</span></div></div>
    {model.sameDay && <div className="precision-warning"><b>同日交易・日線近似</b><span>只顯示當日OHLC，不推測盤中成交先後與MAE／MFE發生順序。</span></div>}
    <div className="replay-layout"><div className="replay-chart">{!model.candles.length ? <div className="replay-empty"><b>缺少可重播的OHLC行情</b><span>圖表不補造價格；右側仍保留成交與計畫證據。</span></div> : <><ReplayCanvas model={model} cursor={replayCursor} selectedEventId={selectedEventId}/><label className="replay-slider"><span>重播至 {cursorDate}</span><input aria-label="交易重播日期" type="range" min="0" max={Math.max(0, model.candles.length - 1)} value={replayCursor} onChange={(event) => setCursor(Number(event.target.value))}/><small>{replayCursor + 1}/{model.candles.length} 個交易日・出場後 {model.postExitCount} 日</small></label></>} </div><aside className="replay-timeline"><div className="timeline-title"><b>事件時間軸</b><span>{model.events.length} 個可追溯事件</span></div><div className="timeline-events">{model.events.map((event: any) => <button key={event.id} type="button" className={`${selectedEventId === event.id ? "selected" : ""} ${event.date && event.date > cursorDate ? "future" : ""}`} onClick={() => selectEvent(event)}><i style={{ background: EVENT_COLOR[event.type] || "#765caa" }}/><span><b>{event.label}</b><small>{event.date || "時間不明"}・{event.detail}</small></span></button>)}</div>{selectedEvent && <div className="event-inspector"><span>目前選取</span><b>{selectedEvent.label}</b><p>{selectedEvent.detail}</p>{selectedEvent.price > 0 && <small>價格 {money(selectedEvent.price, cycle.currency)}</small>}{selectedEvent.quantity > 0 && <small>數量 {selectedEvent.quantity} 股・部位 {selectedEvent.beforeQuantity} → {selectedEvent.afterQuantity}</small>}{selectedEvent.note && <small>{selectedEvent.note}</small>}</div>}</aside></div>
    {model.legacyPlanCount > 0 && <div className="legacy-plan-note">有 {model.legacyPlanCount} 項舊計畫只有最終值、沒有生效時間；已顯示為「歷史值」，不加入動畫時序。</div>}
    <form className="plan-version-form" onSubmit={addVersion}><div><b>新增計畫版本</b><small>建立後只追加，不覆蓋舊版本；事後補登會保留建立時間。</small></div><label>類型<select value={planForm.field} onChange={(event) => setPlanForm({ ...planForm, field: event.target.value })}><option value="stopLoss">停損</option><option value="takeProfit">停利</option><option value="invalidation">失效條件</option></select></label><label>{planForm.field === "invalidation" ? "條件" : "價格"}<input required type={planForm.field === "invalidation" ? "text" : "number"} min={planForm.field === "invalidation" ? undefined : "0"} step="any" value={planForm.value} onChange={(event) => setPlanForm({ ...planForm, value: event.target.value })}/></label><label>生效時間<input required type="datetime-local" value={planForm.effectiveAt} onChange={(event) => setPlanForm({ ...planForm, effectiveAt: event.target.value })}/></label><label>理由<input value={planForm.reason} placeholder="支撐、型態或規則依據" onChange={(event) => setPlanForm({ ...planForm, reason: event.target.value })}/></label><button className="primary" type="submit">加入時間線</button></form>
  </section>;
}

function ScatterPlot({ title, subtitle, points, xValue, yValue, xLabel, yLabel, onSelect }: { title: string; subtitle: string; points: any[]; xValue: (point: any) => number; yValue: (point: any) => number; xLabel: string; yLabel: string; onSelect: (cycleId: string) => void }) {
  const xValues = points.map(xValue).filter(Number.isFinite);
  const yValues = points.map(yValue).filter(Number.isFinite);
  const xMin = Math.min(...xValues, -0.01); const xMax = Math.max(...xValues, 0.01);
  const yMin = Math.min(...yValues, -0.05); const yMax = Math.max(...yValues, 0.05);
  return <article className="behavior-chart"><div><b>{title}</b><small>{subtitle}</small></div>{points.length ? <div className="scatter-stage"><span className="axis-y">{yLabel}</span><span className="axis-x">{xLabel}</span><i className="zero-x"/><i className="zero-y"/>{points.map((point) => { const x = clamp((xValue(point) - xMin) / Math.max(1e-9, xMax - xMin)); const y = clamp((yValue(point) - yMin) / Math.max(1e-9, yMax - yMin)); return <button key={point.cycleId} type="button" className={`scatter-point ${String(point.category || "").toLowerCase()}`} style={{ left: `${8 + x * 84}%`, bottom: `${10 + y * 78}%` }} title={`${point.symbol}・X ${pct(xValue(point))}・Y ${pct(yValue(point))}`} onClick={() => onSelect(point.cycleId)}><span>{point.symbol}</span></button>; })}</div> : <div className="mini-empty">樣本不足</div>}</article>;
}

function ComplianceFunnel({ rows }: { rows: any[] }) {
  const maximum = Math.max(1, rows[0]?.count || 0);
  return <article className="behavior-chart"><div><b>規則遵守漏斗</b><small>從完整閉環到完成復盤的流程轉換</small></div><div className="compliance-funnel">{rows.map((row) => <div key={row.key}><span>{row.label}</span><div><i style={{ width: `${Math.max(4, row.count / maximum * 100)}%` }}/></div><b>{row.count}</b></div>)}</div></article>;
}

function BehaviorHeatmap({ rows, cycleMap, onSelect }: { rows: any[]; cycleMap: Record<string, any>; onSelect: (cycleId: string) => void }) {
  const byDate = Object.fromEntries(rows.map((row) => [row.date, row]));
  const today = new Date().toISOString().slice(0, 10);
  const lastDate = [rows.at(-1)?.date, today].filter(Boolean).sort().at(-1) || today;
  const lastTime = Date.parse(`${lastDate}T00:00:00Z`);
  const end = lastTime + (7 - new Date(lastTime).getUTCDay()) % 7 * 86_400_000;
  const days = Array.from({ length: 42 }, (_, index) => new Date(end - (41 - index) * 86_400_000).toISOString().slice(0, 10));
  return <article className="behavior-chart behavior-heatmap-card"><div><b>行為日曆熱圖</b><small>顏色越深代表同日行為事件或可驗證影響越高</small></div><div className="heatmap-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div className="behavior-heatmap">{days.map((date) => { const row = byDate[date]; const first = row?.events?.[0]; return <button key={date} type="button" className={row ? `heat severity-${row.severity}` : ""} title={row ? `${date}・${row.count}個事件・影響 ${money(row.impactUsd)}` : `${date}・無事件`} onClick={() => first?.cycleId && onSelect(first.cycleId)} disabled={!first?.cycleId}><span>{date.slice(8)}</span>{row && <b>{row.count}</b>}</button>; })}</div><div className="heatmap-evidence">{rows.slice(-5).reverse().map((row) => <button type="button" key={row.date} onClick={() => row.events[0]?.cycleId && onSelect(row.events[0].cycleId)}><b>{row.date}</b><span>{row.events.map((event: any) => `${cycleMap[event.cycleId]?.symbol || "交易"} ${event.evidence}`).join("；")}</span></button>)}</div></article>;
}

function CoachCards({ findings, experiments, cycleMap, onSelect, onCreateExperiment }: { findings: any[]; experiments: any[]; cycleMap: Record<string, any>; onSelect: (cycleId: string) => void; onCreateExperiment: (finding: any) => void }) {
  return <section className="coach-section"><div className="panel-head"><div><p className="eyebrow">WEEKLY COACH</p><h2>本週前三大訓練焦點</h2></div><span className="muted">確定性規則・按可驗證影響排序</span></div>{findings.length ? <div className="coach-cards">{findings.map((finding, index) => { const alreadyActive = experiments.some((experiment) => experiment.findingType === finding.type && experiment.status === "ACTIVE"); return <article key={finding.type}><div className="coach-rank">0{index + 1}</div><div className="coach-card-head"><div><span className={finding.confidence === "待觀察" ? "status warn" : "status ok"}>{finding.confidence}</span><h3>{finding.title}</h3></div><b className={finding.impactUsd > 0 ? "negative" : ""}>{finding.impactUsd > 0 ? money(finding.impactUsd) : `${finding.sampleCount} 次`}</b></div><p>{finding.description}</p><div className="coach-facts"><span>樣本 <b>{finding.sampleCount}</b></span><span>趨勢 <b>{finding.trend}</b></span><span>證據 <b>{finding.evidenceCycleIds.length} 個閉環</b></span></div><div className="evidence-links">{finding.evidenceCycleIds.slice(0, 5).map((cycleId: string) => <button key={cycleId} type="button" onClick={() => onSelect(cycleId)}>{cycleMap[cycleId]?.symbol || cycleId}</button>)}</div><div className="coach-action"><span>下一步</span><p>{finding.action}</p></div><button type="button" className={alreadyActive ? "ghost" : "primary"} disabled={alreadyActive} onClick={() => onCreateExperiment(finding)}>{alreadyActive ? "已有進行中實驗" : "建立改善實驗"}</button></article>; })}</div> : <div className="mini-empty">目前沒有可形成教練卡的客觀行為事件。</div>}</section>;
}

function ExperimentsPanel({ experiments, cycles, behaviorEvents, onUpdate }: { experiments: any[]; cycles: any[]; behaviorEvents: any[]; onUpdate: (id: string, patch: any) => void }) {
  return <section className="experiments-section"><div className="panel-head"><div><p className="eyebrow">IMPROVEMENT EXPERIMENTS</p><h2>改善實驗追蹤</h2></div><span className="muted">以遵守率與違規成本衡量，不以短期報酬定成敗</span></div>{experiments.length ? <div className="experiment-list">{experiments.map((experiment) => { const result = evaluateExperiment(experiment, cycles, behaviorEvents); return <article key={experiment.id}><div className="experiment-head"><div><span className={experiment.status === "ACTIVE" ? "status warn" : "status ok"}>{experiment.status === "ACTIVE" ? "追蹤中" : "已完成"}</span><h3>{experiment.title}</h3></div><button className="ghost" type="button" onClick={() => onUpdate(experiment.id, { status: experiment.status === "ACTIVE" ? "COMPLETED" : "ACTIVE" })}>{experiment.status === "ACTIVE" ? "完成實驗" : "重新開啟"}</button></div><div className="experiment-fields"><label>觸發條件<input value={experiment.trigger} onChange={(event) => onUpdate(experiment.id, { trigger: event.target.value })}/></label><label>預定動作<input value={experiment.action} onChange={(event) => onUpdate(experiment.id, { action: event.target.value })}/></label><label>觀察指標<input value={experiment.metric} onChange={(event) => onUpdate(experiment.id, { metric: event.target.value })}/></label><label>目標<input value={experiment.target} onChange={(event) => onUpdate(experiment.id, { target: event.target.value })}/></label><label>開始日期<input type="date" value={experiment.startDate} onChange={(event) => onUpdate(experiment.id, { startDate: event.target.value })}/></label><label>結束日期<input type="date" value={experiment.endDate} onChange={(event) => onUpdate(experiment.id, { endDate: event.target.value })}/></label></div><div className="experiment-result"><div><span>基準事件</span><b>{experiment.baseline?.violationCount || 0}</b></div><div><span>觀察閉環</span><b>{result.eligibleCount}</b></div><div><span>目前違規率</span><b className={result.rateChange != null && result.rateChange < 0 ? "positive" : result.rateChange > 0 ? "negative" : ""}>{result.violationRate == null ? "待樣本" : pct(result.violationRate)}</b></div><div><span>相對基準</span><b className={result.rateChange != null && result.rateChange < 0 ? "positive" : result.rateChange > 0 ? "negative" : ""}>{result.rateChange == null ? "—" : pct(result.rateChange)}</b></div><div><span>期間影響</span><b>{money(result.impactUsd)}</b></div></div><label className="result-note">結果備註<textarea value={experiment.resultNote || ""} placeholder="完成後記錄有效做法與例外" onChange={(event) => onUpdate(experiment.id, { resultNote: event.target.value })}/></label></article>; })}</div> : <div className="mini-empty">尚未建立改善實驗；可由上方教練卡一鍵建立。</div>}</section>;
}

export function TrainingWorkspace({ cycles, marketBars, reviews, planHistory, rapidPairs, experiments, fxRate, onSelectCycle, onCreateExperiment, onUpdateExperiment }: { cycles: any[]; marketBars: any[]; reviews: Record<string, any>; planHistory: any[]; rapidPairs: any[]; experiments: any[]; fxRate: number | null; onSelectCycle: (cycleId: string) => void; onCreateExperiment: (finding: any) => void; onUpdateExperiment: (id: string, patch: any) => void }) {
  const behaviorEvents = useMemo(() => detectBehaviorEvents(cycles, marketBars, reviews, rapidPairs, planHistory, fxRate), [cycles, fxRate, marketBars, planHistory, rapidPairs, reviews]);
  const dashboard = useMemo(() => buildBehaviorDashboard(cycles, marketBars, reviews, planHistory, behaviorEvents), [behaviorEvents, cycles, marketBars, planHistory, reviews]);
  const findings = useMemo(() => buildCoachFindings(behaviorEvents), [behaviorEvents]);
  const cycleMap = useMemo(() => Object.fromEntries(cycles.map((cycle) => [cycle.id, cycle])), [cycles]);
  return <div className="training-workspace">
    <CoachCards findings={findings} experiments={experiments} cycleMap={cycleMap} onSelect={onSelectCycle} onCreateExperiment={onCreateExperiment}/>
    <section className="behavior-section"><div className="panel-head"><div><p className="eyebrow">BEHAVIOR VISUALS</p><h2>交易行為視覺化</h2></div><span className="muted">每個點與事件都可回到原始閉環</span></div><div className="behavior-grid"><ScatterPlot title="MFE留存矩陣" subtitle="找出曾賺後轉虧與高留存出場" points={dashboard.retention} xValue={(point) => point.mfePct} yValue={(point) => point.returnPct} xLabel="MFE →" yLabel="實際報酬" onSelect={onSelectCycle}/><ScatterPlot title="MAE／報酬矩陣" subtitle="辨識深虧硬抱與有效風控" points={dashboard.maeReturn} xValue={(point) => point.maePct} yValue={(point) => point.returnPct} xLabel="← MAE" yLabel="實際報酬" onSelect={onSelectCycle}/><ComplianceFunnel rows={dashboard.funnel}/><BehaviorHeatmap rows={dashboard.heatmap} cycleMap={cycleMap} onSelect={onSelectCycle}/></div></section>
    <ExperimentsPanel experiments={experiments} cycles={cycles} behaviorEvents={behaviorEvents} onUpdate={onUpdateExperiment}/>
  </div>;
}
