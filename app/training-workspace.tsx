/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import {useValuation} from './valuation-context';
import {cycleGroupValuation} from '@/lib/valuation-reports.mjs';
import {FitNumber,MobileDetails} from "./mobile-ui";

import { BehaviorMatrices } from "./behavior-matrices";
import { ReplayEventSymbol } from "./replay-event-symbol";
import { EMA_PERIODS } from "@/lib/chart-indicators.mjs";
import {ReplayCanvas, EMA_STYLE} from "./replay-canvas";
let enabledEmaForPage: number[] = [10, 21, 50];
import { EntryContextEvidence } from "./trade-entry-workspace";
import { replayFocus } from "@/lib/position-ledger.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildBehaviorDashboard, buildCycleReplay, buildOpenPositionReplay, buildProfitLossTradeStats, buildTradeQualityAnalysis, cycleAnalysisPeriod, filterCyclesByPeriod } from "@/lib/coach-engine.mjs";
import { ReviewLedgerTable } from "./review-ledger-table";
import {InfoPopover,InfoPopoverGroup} from "./info-popover";
import { WorkspaceTabs } from "./workspace-ui";

function pct(value: number | null, digits = 1) { return value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`; }
function plainPct(value: number | null, digits = 1) { return value == null ? "—" : `${(value * 100).toFixed(digits)}%`; }
function money(value: number | null, currency = "USD") { return value == null ? "—" : new Intl.NumberFormat("zh-TW", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2 }).format(value); }
function volume(value: number | null) { return value == null ? "—" : new Intl.NumberFormat("zh-TW", { notation: "compact", maximumFractionDigits: 2 }).format(value); }
function dateInput(value: string) { return value ? new Date(value).toISOString().slice(0, 16) : ""; }



export function ReplayBoard({ entryContexts = {}, initialEventId, activeEventId, onEventSelect, cycle, marketBars, planHistory, review, rapidPairs, decisionLinks, strategies = [], strategyAssignments = {}, onAddPlanVersion, openPlan, showPlanEditor = true, showEntryEvidence = true }:  { entryContexts?: Record<string, any>; initialEventId?: string; activeEventId?:string|null; onEventSelect?:(id:string)=>void; cycle: any; marketBars: any[]; planHistory: any[]; review: any; rapidPairs: any[]; decisionLinks: Record<string, any>; strategies?: any[]; strategyAssignments?: Record<string, any>; onAddPlanVersion: (version: any) => void; openPlan?: any; showPlanEditor?: boolean; showEntryEvidence?: boolean }) {
  const isOpen = cycle.status === "OPEN";
  const model = useMemo(() => isOpen ? buildOpenPositionReplay(cycle, marketBars, planHistory, openPlan || {}, new Date(), strategies, strategyAssignments, entryContexts) : buildCycleReplay(cycle, marketBars, planHistory, review, rapidPairs, decisionLinks, strategies, strategyAssignments, entryContexts), [cycle, decisionLinks, isOpen, marketBars, openPlan, planHistory, rapidPairs, review, strategies, strategyAssignments, entryContexts]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [localEventId, setLocalEventId] = useState<string | null>(initialEventId || null);
  const selectedEventId=activeEventId===undefined?localEventId:activeEventId;
  const [cursorEvent,setCursorEvent]=useState(selectedEventId);
  const setSelectedEventId=(id:string)=>{setLocalEventId(id);onEventSelect?.(id);setCursorEvent(id);};
  const focused = replayFocus(model, selectedEventId);
  const [planForm, setPlanForm] = useState({ field: "stopLoss", value: "", effectiveAt: dateInput(cycle.openAt), reason: "" });
  const replayCursor = cursor == null || cursorEvent!==selectedEventId ? (focused.cursor ?? Math.max(0, model.candles.length - 1)) : Math.min(cursor, Math.max(0, model.candles.length - 1));
  const cursorDate = model.candles[replayCursor]?.date || model.closeDate;
  const [rulerEnabled, setRulerEnabled] = useState(false);
  const [rulerClear, setRulerClear] = useState(0);
  const [enabledEma, setEnabledEma] = useState<number[]>(() => [...enabledEmaForPage]);
  const [inspection, setInspection] = useState<{key:string;index:number} | null>(null);
  const inspectionKey = JSON.stringify([cycle.id, replayCursor]);
  const inspectedIndex = inspection?.key === inspectionKey ? inspection.index : replayCursor;
  const cursorCandle = model.candles[inspectedIndex] || null;
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
    <div className="replay-head"><div><h3>{isOpen ? "持倉 K 線與交易計畫" : "交易決策重播"}</h3><small>{isOpen ? "進場前三個月 → 目前・進場位置與最新停損／停利" : "進場前三個月 → 出場後三個月・完整日K價量"}</small></div><div className="replay-legend"><span><i className="marker-legend-entry">▲ ＋</i>建倉／加碼</span><span><i className="marker-legend-exit">− ▼</i>減碼／出場</span><span><i className="stop-line"/>停損</span><span><i className="target-line"/>停利</span><span><i className="volume-bar"/>成交量</span><span><i className="volume-average"/>20日均量</span></div></div>
    {model.sameDay && <div className="precision-warning"><b>同日交易・日線近似</b><span>只顯示當日OHLC，不推測盤中成交先後與MAE／MFE發生順序。</span></div>}
    {focused.missingCandle && <p className="precision-warning" role="status">已選取 {focused.event.date} 的成交／事件，但目前缺少該日日K；保留事件資料，不以其他日期代替。</p>}
    <div className="replay-layout"><div className="replay-chart">{!model.candles.length ? <div className="replay-empty"><b>缺少可重播的OHLC行情</b><span>圖表不補造價格；右側仍保留成交與計畫證據。</span></div> : <><div className="ema-controls" role="group" aria-label="均線顯示">{EMA_PERIODS.map(period => <button type="button" key={period} aria-pressed={enabledEma.includes(period)} onClick={() => { const next=enabledEma.includes(period)?enabledEma.filter(p=>p!==period):[...enabledEma,period]; enabledEmaForPage=next; setEnabledEma(next); setInspection(null); }}><i style={{borderTopColor:EMA_STYLE[period].color,borderTopStyle:period===10?"solid":period===21?"dashed":"dotted"}}/>EMA {period}</button>)}<button type="button" className="ruler-toggle" aria-pressed={rulerEnabled} onClick={() => {setRulerEnabled(!rulerEnabled);setInspection(null);}}>價格量尺</button>{rulerEnabled && <button type="button" onClick={() => {setRulerClear(value=>value+1);setInspection(null);}}>清除量尺</button>}<small>{rulerEnabled ? "點兩下量測・自動吸附開高低收・Esc 退出" : "移動游標查看 K 棒・左右鍵逐棒檢視"}</small></div><ReplayCanvas model={model} cursor={replayCursor} selectedEventId={selectedEventId} enabledEma={enabledEma} currency={cycle.currency || "USD"} emaCandle={cursorCandle} rulerEnabled={rulerEnabled} rulerClear={rulerClear} onExitRuler={() => {setRulerEnabled(false);setInspection(null);}} onSelectMarker={(id) => { setCursor(replayCursor); setSelectedEventId(id); }} onInspect={(index) => setInspection(index == null ? null : {key:inspectionKey,index})}/>{cursorCandle && <div className="replay-market-strip"><div className="replay-market-day"><b>{cursorCandle.date}</b><span>{cursorPhase}</span></div><div><span>開盤</span><b>{cursorCandle.open.toFixed(2)}</b></div><div><span>最高</span><b>{cursorCandle.high.toFixed(2)}</b></div><div><span>最低</span><b>{cursorCandle.low.toFixed(2)}</b></div><div><span>收盤</span><b>{cursorCandle.close.toFixed(2)}</b></div><div><span>當日成交量</span><b>{volume(cursorCandle.volume)}</b></div><div><span>20日均量</span><b>{volume(cursorCandle.averageVolume20)}</b></div><div><span>量比</span><b className={cursorCandle.volumeRatio != null && cursorCandle.volumeRatio >= 1.5 ? "volume-hot" : ""}>{cursorCandle.volumeRatio == null ? "—" : `${cursorCandle.volumeRatio.toFixed(2)}x`}</b></div></div>}{model.candles.slice(0,replayCursor+1).some((candle:any) => EMA_PERIODS.some(period => candle.ema?.[period] == null)) && <p className="ema-missing" role="status">部分日期均線資料不足；不足期數不繪製均線。</p>}<label className="replay-slider"><span>重播至 {cursorDate}</span><input aria-label="交易重播日期" type="range" min="0" max={Math.max(0, model.candles.length - 1)} value={replayCursor} onChange={(event) => {setCursorEvent(selectedEventId);setCursor(Number(event.target.value));}}/><small>{replayCursor + 1}/{model.candles.length}・進場前 {model.preEntryCount}／持有 {model.holdingCount}／出場後 {model.postExitCount} 個交易日</small></label></>} </div><aside className="replay-timeline"><div className="timeline-title"><b>事件時間軸</b><span>{model.events.length} 個可追溯事件</span></div><div className="timeline-events">{model.events.map((event: any) => <button key={event.id} type="button" className={`${selectedEventId === event.id ? "selected" : ""} ${event.date && event.date > cursorDate ? "future" : ""}`} onClick={() => selectEvent(event)}><ReplayEventSymbol type={event.type}/><span><b>{event.label}</b><small>{event.date || "時間不明"}・{event.detail}</small></span></button>)}</div>{selectedEvent && <div className="event-inspector"><span>目前選取</span><b>{selectedEvent.label}</b><p>{selectedEvent.detail}</p>{selectedEvent.price > 0 && <small>價格 {money(selectedEvent.price, cycle.currency)}</small>}{"quantity" in selectedEvent && selectedEvent.quantity > 0 && <small>數量 {selectedEvent.quantity} 股・部位 {selectedEvent.beforeQuantity} → {selectedEvent.afterQuantity}</small>}{"note" in selectedEvent && selectedEvent.note && <small>{selectedEvent.note}</small>}</div>}</aside></div>
    {showEntryEvidence && selectedEvent && "entryContext" in selectedEvent && <InfoPopoverGroup><EntryContextEvidence contexts={{[(selectedEvent as any).entryContext.fillId]:(selectedEvent as any).entryContext}} cycleId={cycle.id} fills={cycle.fills}/></InfoPopoverGroup>}
    {model.legacyPlanCount > 0 && <div className="legacy-plan-note">有 {model.legacyPlanCount} 項舊計畫只有最終值、沒有生效時間；已顯示為「歷史值」，不加入動畫時序。</div>}
    {isOpen ? <div className="open-plan-replay-note">請在下方「目前計畫」更新停損、停利與失效條件；按「儲存計畫」一次追加版本，平倉後會沿同一筆交易 ID 進入閉環與行為分析。</div> : showPlanEditor ? <form className="plan-version-form" onSubmit={addVersion}><div><b>新增計畫版本</b><small>建立後只追加，不覆蓋舊版本；事後補登會保留建立時間。</small></div><label>類型<select value={planForm.field} onChange={(event) => setPlanForm({ ...planForm, field: event.target.value })}><option value="stopLoss">停損</option><option value="takeProfit">停利</option><option value="invalidation">失效條件</option></select></label><label>{planForm.field === "invalidation" ? "條件" : "價格"}<input required type={planForm.field === "invalidation" ? "text" : "number"} min={planForm.field === "invalidation" ? undefined : "0"} step="any" value={planForm.value} onChange={(event) => setPlanForm({ ...planForm, value: event.target.value })}/></label><label>生效時間<input required type="datetime-local" value={planForm.effectiveAt} onChange={(event) => setPlanForm({ ...planForm, effectiveAt: event.target.value })}/></label><label>理由<input value={planForm.reason} placeholder="支撐、型態或規則依據" onChange={(event) => setPlanForm({ ...planForm, reason: event.target.value })}/></label><button className="primary" type="submit">加入時間線</button></form> : null}
  </section>;
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
      const width = Math.max(420, canvas.parentElement?.clientWidth || 420);
      const dpr = window.devicePixelRatio || 1;
      const margin = { left: 72, right: 18, top: 48, bottom: 38 };
      const columns = 36;
      const rows = 49;
      const cellWidth = (width - margin.left - margin.right) / columns;
      const cellHeight = 5;
      const height = margin.top + rows * cellHeight + margin.bottom;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const expectancy = (rate: number, ratio: number) => (rate / 100) * ratio - (1 - rate / 100);
      const color = (value: number) => {
        if (Math.abs(value) < 0.025) return "#e8e5df";
        if (value < 0) return `hsl(355 72% ${88 - 52 * Math.min(1, Math.abs(value) / 0.58)}%)`;
        return `hsl(126 69% ${88 - 58 * Math.pow(Math.min(1, value / 2.6), 0.72)}%)`;
      };
      context.fillStyle = getComputedStyle(canvas).getPropertyValue("--ink").trim() || "#26312d";
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
          context.fillStyle = getComputedStyle(canvas).getPropertyValue("--muted").trim() || "#52605a";
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
    return () => observer.disconnect();
  }, [inRange, rewardRisk, winRatePct]);

  const hasSample = stats.winners.count > 0 && stats.losers.count > 0;
  return <section className="expectancy-map"><div className="expectancy-canvas-wrap" tabIndex={0} role="region" aria-label="期望值圖表，可橫向捲動"><canvas ref={canvasRef} role="img" aria-label={`${label}的勝率與平均盈虧比期望值熱圖`}/></div><div className="expectancy-legend"><span>強負期望</span><i className="negative-strong"/><i className="negative-light"/><i className="neutral"/><i className="positive-light"/><i className="positive-strong"/><span>強正期望</span><b/><span>損益兩平</span><details className="expectancy-help"><summary aria-label="展開期望值圖表說明" title="圖表說明"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1 10 6 3 11Z" fill="currentColor"/></svg></summary><div><strong>勝率與風報比期望值</strong><p>每格為 2% 勝率 × 0.1 風報比；黑線是損益兩平，黃色圓點是目前選定區間。</p></div></details></div>{!hasSample && <small className="expectancy-note">此區間必須至少各有一筆獲利與虧損交易，才能計算風報比與定位。</small>}{hasSample && !inRange && <small className="expectancy-note">目前結果超出圖表範圍（勝率 10%–80%、盈虧比 0.2–5），保留實際數值但不將標記壓在線框邊緣。</small>}</section>;
}

function ProfitLossAnalysis({ stats:original, scope, period }: { stats: ReturnType<typeof buildProfitLossTradeStats>; scope: string; period: string }) {
 const valuation=useValuation();const money=(value:number|null)=>valuation.format(value);
 const convert=(group:any,cycles:any[])=>{const v=cycleGroupValuation(cycles,valuation.currency,valuation.fxBars);return {...group,totalPnlUsd:v.total,averagePnlUsd:v.average,averageEntryNotionalUsd:v.entryAverage,missingFxCount:v.missing,missingFx:v.missing>0};};
 const all=cycleGroupValuation(original.cycles,valuation.currency,valuation.fxBars);
 const stats={...original,totalPnlUsd:all.total,missingFxCount:all.missing,winners:convert(original.winners,original.cycles.filter(c=>c.pnl>0)),losers:convert(original.losers,original.cycles.filter(c=>c.pnl<0))};
  const groups = [{ key: "profit", title: "總獲利單", tone: "positive", data: stats.winners }, { key: "loss", title: "總虧損單", tone: "negative", data: stats.losers }];
  return <><section className="profit-loss-analysis"><div className="analysis-head"><div className="section-title-help"><h2>盈虧結構</h2><InfoPopover label="盈虧結構" mobilePresentation="sheet"><p>依出場日期分組；平均投入持倉金額為每個閉環的總進場成交金額，全部依有效歷史匯率換算為所選幣別等值。</p><p>勝率＝獲利 ÷ 獲利與虧損交易；風報比＝平均獲利率 ÷ 平均虧損率絕對值；交易期望值＝勝率 × 風報比 − 虧損機率。</p><p>平均報酬與金額採閉環算術平均；平均持有天數沿用閉環日曆天數，每個閉環等權計算。總盈虧為各閉環損益加總，已含登錄費用。依閉環平倉日匯率換算，缺少匯率不推測數值。所有數值受區間、策略、版本及呈現筆數篩選影響。</p></InfoPopover></div><strong className="analysis-sample">{periodLabel(scope, period)}・{stats.cycles.length} 筆</strong></div><div className="profit-loss-top"><div className="edge-summary"><div><span>總盈虧</span><b className={stats.totalPnlUsd == null || stats.totalPnlUsd === 0 ? "" : stats.totalPnlUsd > 0 ? "positive" : "negative"}><FitNumber>{money(stats.totalPnlUsd)}</FitNumber></b>{stats.missingFxCount > 0 && <small>缺少匯率・{stats.missingFxCount} 筆</small>}</div><div><span>勝率</span><b><FitNumber>{stats.winRate == null ? "—" : `${(stats.winRate * 100).toFixed(1)}%`}</FitNumber></b></div><div><span>風報比</span><b><FitNumber>{stats.rewardRisk == null ? "—" : stats.rewardRisk.toFixed(2)}</FitNumber></b></div><div><span>期望值</span><b className={stats.expectancyR == null ? "" : stats.expectancyR >= 0 ? "positive" : "negative"}><FitNumber>{stats.expectancyR == null ? "—" : `${stats.expectancyR >= 0 ? "+" : ""}${stats.expectancyR.toFixed(2)}R`}</FitNumber></b></div></div><ExpectancyHeatmap stats={stats} label={periodLabel(scope, period)}/></div><div className="profit-loss-groups">{groups.map((group) => <article key={group.key} className={`profit-loss-group ${group.key}`}><div><span>{group.title}</span><b className={group.tone}>{group.data.count} 筆</b></div><dl><div className="group-total"><dt>{group.key === "profit" ? "總獲利" : "總虧損"}</dt><dd className={group.data.totalPnlUsd === 0 ? "" : group.tone}><FitNumber>{money(group.data.totalPnlUsd)}</FitNumber></dd>{group.data.missingFxCount > 0 && <small>缺少匯率・{group.data.missingFxCount} 筆</small>}</div><div><dt>{group.key === "profit" ? "平均獲利率" : "平均虧損率"}</dt><dd className={group.tone}>{pct(group.data.averageReturn)}</dd></div><div><dt>{group.key === "profit" ? "平均獲利金額" : "平均虧損金額"}</dt><dd className={group.tone}><FitNumber>{money(group.data.averagePnlUsd)}</FitNumber></dd><small>{group.data.missingFx ? "缺少USDTWD，不推測" : `${valuation.currency} 等值`}</small></div><div><dt>平均投入持倉金額</dt><dd><FitNumber>{money(group.data.averageEntryNotionalUsd)}</FitNumber></dd></div><div><dt>平均持有天數</dt><dd>{group.data.averageHoldingDays == null ? "—" : `${group.data.averageHoldingDays.toFixed(1)} 天`}</dd>{group.data.missingHoldingDays > 0 && <small>缺少日期・{group.data.missingHoldingDays} 筆</small>}</div></dl></article>)}</div>{stats.flatCount > 0 && <small className="analysis-flat-note">另有 {stats.flatCount} 筆損益兩平交易，未納入獲利或虧損組。</small>}</section></>;
}

function QualityDistributionCard({ group, cycles, onSelectCycle }: { group: any; cycles: any[]; onSelectCycle: (cycleId: string) => void }) {
  const cycleName = (cycleId: string) => cycles.find((cycle) => cycle.id === cycleId)?.symbol || "閉環";
  return <article className={`quality-distribution-card ${String(group.id).toLowerCase()}`}>
    <div className="quality-distribution-head"><div><h3>{group.title}</h3></div><span className={`status ${group.sampleState === "ESTABLISHED" ? "ok" : "warn"}`}>{group.sampleState === "ESTABLISHED" ? "樣本已建立" : `${group.ratedCount}/20・待觀察`}</span></div>
    <div className="quality-distribution-stats"><span>適用 <b>{group.applicableCount}</b></span><span>已評 <b>{group.ratedCount}</b></span><span>待評 <b>{group.pendingCount}</b></span><span>覆蓋 <b>{plainPct(group.coverage)}</b></span></div>
    <div className="quality-distribution-items">{group.items.map((item: any) => <div key={item.value} className={`quality-distribution-row ${String(item.value).toLowerCase()}`}>
      <div><span><b>{item.label}</b><small>{item.description}</small></span><strong>{item.count} 筆・{item.percentage == null ? "—" : `${item.percentage.toFixed(1)}%`}</strong></div>
      <i><span style={{ width: `${(item.rate || 0) * 100}%` }}/></i>
      {item.cycleIds.length > 0 && <details className="quality-distribution-evidence-list"><summary>查看 {item.count} 筆證據閉環</summary><div className="quality-distribution-evidence">{item.cycleIds.map((cycleId: string) => <button type="button" key={cycleId} onClick={() => onSelectCycle(cycleId)}>{cycleName(cycleId)}・{cycles.find((cycle) => cycle.id === cycleId)?.closeAt?.slice(0, 10)}</button>)}</div></details>}
    </div>)}</div>
  </article>;
}

function QualityTagDistribution({ analysis, cycles, onSelectCycle }: { analysis: any; cycles: any[]; onSelectCycle: (cycleId: string) => void }) {
  return <section className="quality-tag-distribution"><div className="panel-head"><div className="section-title-help"><h2>品質評分</h2><InfoPopover label="交易品質標籤分布"><p>人工單選是主要評分結論；點擊標的可回到原始閉環、K 線與回顧證據。比例只計入已評分交易。</p></InfoPopover></div><div className="quality-rating-total"><span>進出場皆完成</span><b>{analysis.fullyRatedCount}/{analysis.total}</b><small>完整覆蓋率 {plainPct(analysis.completeCoverage)}</small></div></div><div className="quality-distribution-grid"><QualityDistributionCard group={analysis.entry} cycles={cycles} onSelectCycle={onSelectCycle}/><QualityDistributionCard group={analysis.profitExit} cycles={cycles} onSelectCycle={onSelectCycle}/><QualityDistributionCard group={analysis.stopExit} cycles={cycles} onSelectCycle={onSelectCycle}/></div></section>;
}

export function TrainingWorkspace({ accountId = "", cycles, marketBars, reviews, fxRate, strategies = [], strategyAssignments = {}, onSelectCycle, dataset, fetchHistory }: { accountId?: string; dataset: any; fetchHistory: typeof fetch; entryContexts?: Record<string, any>; cycles: any[]; marketBars: any[]; reviews: Record<string, any>; fxRate: number | null; strategies?: any[]; strategyAssignments?: Record<string, any>; onSelectCycle: (cycleId: string) => void }) {
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
  const scopedCycles = useMemo(() => strategyOnlyCycles.filter((cycle: any) => scope === "all" || cycleAnalysisPeriod(cycle, scope) === period), [period, scope, strategyOnlyCycles]);
  const periodCycles = useMemo(() => filterCyclesByPeriod(scopedCycles, "", "", Number(sampleLimit)), [sampleLimit, scopedCycles]);
  const quality = useMemo(() => buildTradeQualityAnalysis(periodCycles, marketBars, reviews), [marketBars, periodCycles, reviews]);
  const matrices = useMemo(() => buildBehaviorDashboard(periodCycles, marketBars, reviews, [], []), [marketBars, periodCycles, reviews]);
  const profitLossStats = useMemo(() => buildProfitLossTradeStats(periodCycles, scope, period, fxRate), [periodCycles, fxRate, period, scope]);
  return <div className="training-workspace quality-workspace">
    <section className="strategy-analysis-filters" aria-label="交易分析篩選"><div className="analysis-period-controls"><label>資料區間<select value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">總累計</option><option value="year">年區間</option><option value="month">月區間</option><option value="week">週區間</option></select></label>{scope !== "all" && <label>選擇期間<select value={period} onChange={(event) => setPeriod(event.target.value)}>{options.map((option) => <option key={option} value={option}>{periodLabel(scope, option)}</option>)}</select></label>}<strong>{periodLabel(scope, period)}・{periodCycles.length} 筆</strong></div><label>策略<select value={strategyId} onChange={(event) => { setStrategyId(event.target.value); setVersionId(""); }}><option value="">全部策略與未指派交易</option>{strategies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><MobileDetails className="analysis-advanced" label={`進階篩選・${versionId?"指定版本":"全部版本"}・${sampleLimit==="0"?"全部":sampleLimit+" 筆"}`}><label>版本<select value={versionId} disabled={!strategyId} onChange={(event) => setVersionId(event.target.value)}><option value="">全部版本</option>{(strategy?.versions || []).map((version: any) => <option key={version.id} value={version.id}>v{version.version}・{version.changeReason}</option>)}</select></label><label>呈現筆數<select value={sampleLimit} onChange={(event) => setSampleLimit(event.target.value)}><option value="0">全部</option><option value="10">最新 10 筆</option><option value="25">最新 25 筆</option><option value="50">最新 50 筆</option></select></label></MobileDetails><InfoPopover label="分析篩選"><p>三個分頁共用所選區間、策略、版本與筆數；切換分頁保留目前篩選。</p></InfoPopover></section>
    <WorkspaceTabs label="交易行為分析" items={[
      {id:"performance-structure",label:"盈虧結構",content:<ProfitLossAnalysis stats={profitLossStats} scope={scope} period={period}/>},
      {id:"return-analysis",label:"報酬品質",content:<section className="matrix-section"><div className="matrix-head"><div className="section-title-help"><h2>報酬品質</h2><InfoPopover label="報酬品質"><p>每個點代表一筆交易閉環；點選先看摘要，再開啟 K 線復盤。</p></InfoPopover></div><div className="matrix-filters"><strong>{periodLabel(scope, period)}・篩選 {periodCycles.length}／{scopedCycles.length} 筆</strong></div></div><BehaviorMatrices key={JSON.stringify([accountId, scope, period, strategyId, versionId, sampleLimit])} data={matrices} onSelectCycle={onSelectCycle}/></section>},
      {id:"quality-rating",label:"逐筆複盤",content:<div className="review-analysis-panel"><QualityTagDistribution analysis={quality.tagAnalysis} cycles={periodCycles} onSelectCycle={onSelectCycle}/><ReviewLedgerTable accountId={accountId} allCycles={cycles} dataset={dataset} cycles={periodCycles} lossSampleCycles={scopedCycles} trades={quality.trades} fetchHistory={fetchHistory} onSelectCycle={onSelectCycle}/></div>}
    ]}/>
  </div>;
}
