/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { isCycleReviewPending } from "@/lib/coach-brief.mjs";
import { ProductOnboarding } from "./product-onboarding";

const KIND_LABEL: Record<string, string> = {
  DATA: "資料",
  RISK: "風險",
  REVIEW: "復盤",
  BEHAVIOR: "行為",
  POSITIVE: "狀態",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  FACT: "已確認事實",
  OBSERVATION: "待觀察",
  PATTERN: "重複模式",
};

function formatMoney(value: number | null, currency = "USD") {
  return value == null ? "—" : new Intl.NumberFormat("zh-TW", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 0 }).format(value);
}

export function TodayWorkspace({ brief, positionRows, cycles, reviews, totalEquityUsd, qualityPct, onboardingOpen, experiment, experimentResult, experimentSuggestion, onGuide, onGuideFinish, onStartExperiment, onCompleteExperiment, onAction, onPosition, onCycle }: {
  brief: any[];
  positionRows: any[];
  cycles: any[];
  reviews: Record<string, any>;
  totalEquityUsd: number | null;
  qualityPct: number;
  onboardingOpen: boolean;
  experiment: any | null;
  experimentResult: any | null;
  experimentSuggestion: any | null;
  onGuide: () => void;
  onGuideFinish: () => void;
  onStartExperiment: () => void;
  onCompleteExperiment: () => void;
  onAction: (target: string) => void;
  onPosition: (positionId: string) => void;
  onCycle: (cycleId: string) => void;
}) {
  const riskRows = positionRows.filter((row) => row.metrics?.stopBreached || !(Number(row.plan?.stopLoss) > 0)).slice(0, 4);
  const pendingCycles = [...cycles].filter((cycle) => isCycleReviewPending(reviews[cycle.id] || {})).sort((a, b) => String(b.closeAt).localeCompare(String(a.closeAt))).slice(0, 4);
  const dateLabel = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "long", day: "numeric", weekday: "long" }).format(new Date());

  function run(item: any) {
    const { target, entityId } = item.nextAction;
    if (target === "position" && entityId) onPosition(entityId);
    else if (target === "cycle" && entityId) onCycle(entityId);
    else onAction(target);
  }

  return <div className="today-workspace">
    <header className="today-intro">
      <p>{dateLabel}・規則型摘要</p>
      <div className="today-intro-heading"><h2>今天先處理這{brief.length === 1 ? "一" : brief.length === 2 ? "兩" : "三"}件事</h2><button type="button" className="text-button" onClick={onGuide}>使用導覽</button></div>
      <span>先看需要決定的事，再展開數字。每項建議都能回到原始交易或計算證據。</span>
    </header>
    {onboardingOpen && <ProductOnboarding onFinish={onGuideFinish}/>}

    <section className="today-actions" aria-labelledby="today-actions-title">
      <h3 id="today-actions-title" className="sr-only">今日優先行動</h3>
      <ol>
        {brief.map((item) => <li key={item.id} className={`today-action today-action-${item.kind.toLowerCase()}`}>
          <div className="today-action-meta"><span>{KIND_LABEL[item.kind]}</span><small>{CONFIDENCE_LABEL[item.confidence]}</small></div>
          <div className="today-action-copy"><h3>{item.title}</h3><p>{item.reason}</p><details><summary>為什麼看到這項提醒</summary><ul>{item.evidenceRefs.map((evidence: string) => <li key={evidence}>{evidence}</li>)}</ul></details></div>
          <button type="button" className={item.kind === "RISK" ? "primary" : "ghost"} onClick={() => run(item)}>{item.nextAction.label}<span aria-hidden="true"> →</span></button>
        </li>)}
      </ol>
    </section>

    <div className="today-columns">
      <section className="today-section" aria-labelledby="today-risk-title">
        <div className="today-section-head"><div><h3 id="today-risk-title">目前風險</h3><p>只列出已觸發或缺少停損的持倉。</p></div><button type="button" className="text-button" onClick={() => onAction("overview")}>全部持倉</button></div>
        {riskRows.length ? <div className="today-row-list">{riskRows.map(({ position, plan, metrics }) => <button type="button" key={position.id} onClick={() => onPosition(position.id)}><span><b>{position.symbol}</b><small>{metrics.stopBreached ? "已越過停損" : "尚未設定停損"}</small></span><span><b>{metrics.allocationPct == null ? "占比待更新" : `${(metrics.allocationPct * 100).toFixed(1)}%`}</b><small>{plan.stopLoss ? `停損 ${plan.stopLoss}` : `${position.quantity} 股`}</small></span></button>)}</div> : <p className="today-clear">目前持倉都有停損，且沒有觸發警示。</p>}
      </section>

      <section className="today-section" aria-labelledby="today-review-title">
        <div className="today-section-head"><div><h3 id="today-review-title">待復盤</h3><p>由最近平倉、尚未完成判斷的交易開始。</p></div><button type="button" className="text-button" onClick={() => onAction("cycles")}>全部閉環</button></div>
        {pendingCycles.length ? <div className="today-row-list">{pendingCycles.map((cycle) => <button type="button" key={cycle.id} onClick={() => onCycle(cycle.id)}><span><b>{cycle.symbol}</b><small>{String(cycle.closeAt).slice(0, 10)} 平倉</small></span><span><b className={cycle.pnl >= 0 ? "positive" : "negative"}>{formatMoney(cycle.pnl, cycle.currency)}</b><small>開始復盤 →</small></span></button>)}</div> : <p className="today-clear">近期閉環都已完成復盤。</p>}
      </section>
    </div>

    {(experiment || experimentSuggestion) && <section className="today-experiment" aria-labelledby="today-experiment-title">
      <div className="today-experiment-heading"><div><p>一次只改一件事</p><h3 id="today-experiment-title">{experiment ? experiment.title : `建議實驗：${experimentSuggestion.title}`}</h3></div>{experiment ? <span className="experiment-status">進行中・{experiment.startDate} → {experiment.endDate}</span> : <button type="button" className="primary" onClick={onStartExperiment}>開始兩週實驗</button>}</div>
      {experiment ? <><dl><div><dt>觸發條件</dt><dd>{experiment.trigger}</dd></div><div><dt>要採取的行動</dt><dd>{experiment.action}</dd></div><div><dt>追蹤指標</dt><dd>{experiment.metric}</dd></div><div><dt>目標</dt><dd>{experiment.target}</dd></div></dl><div className="experiment-progress"><span>目前納入 {experimentResult?.eligibleCount || 0} 筆・違規 {experimentResult?.violationCount || 0} 次{experimentResult?.violationRate == null ? "" : `・違規率 ${(experimentResult.violationRate * 100).toFixed(0)}%`}</span><button type="button" className="ghost" onClick={onCompleteExperiment}>結束並保留結果</button></div></> : <p className="experiment-suggestion">根據 {experimentSuggestion.sampleCount} 筆可追溯樣本，先驗證「{experimentSuggestion.action}」；建立後會固定基線與兩週期限。</p>}
    </section>}

    <section className="today-snapshot" aria-labelledby="today-snapshot-title">
      <div><h3 id="today-snapshot-title">帳戶快照</h3><p>只保留判斷方向需要的三個數字。</p></div>
      <dl><div><dt>目前總資產</dt><dd>{formatMoney(totalEquityUsd)}</dd></div><div><dt>未平倉</dt><dd>{positionRows.length} 個部位</dd></div><div><dt>資料完整度</dt><dd>{qualityPct}%</dd></div></dl>
    </section>
  </div>;
}
