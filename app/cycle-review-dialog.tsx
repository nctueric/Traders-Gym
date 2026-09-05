/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState } from "react";
import { analyzeCycle } from "@/lib/review-engine.mjs";
import { cycleReviewProgress } from "@/lib/review-flow.mjs";
import { DetailFrame } from "./workspace-ui";
import { EntryContextEvidence } from "./trade-entry-workspace";
import { QualityTagPicker } from "./quality-rating-control";
import { StrategyChecklist } from "./strategy-workspace";
import { ReplayBoard } from "./training-workspace";

function pct(value: number | null) { return value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`; }
function money(value: number, currency = "USD") { return new Intl.NumberFormat("zh-TW", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2 }).format(value); }
function localDateTime(value?: string) { return value ? new Date(value).toLocaleString("zh-TW", { hour12: false }) : "尚未設定"; }

export function CycleReviewDialog({ entryContexts, cycle, marketBars, review, planHistory, rapidPairs, cycles, decisionLinks, decisionLinkHistory, strategies, strategyAssignments, onAssignStrategy, onStrategyCheck, onAddPlanVersion, onReviewChange, onToggleDecisionLink, onClose }: any) {
  const analysis = analyzeCycle(cycle, marketBars, review);
  const progress = cycleReviewProgress(review);
  const [step, setStep] = useState(progress.nextIncompleteIndex);
  const relatedPairs = rapidPairs.filter((pair: any) => pair.previousCycleId === cycle.id || pair.nextCycleId === cycle.id);
  const cycleNames = Object.fromEntries(cycles.map((item: any) => [item.id, `${item.symbol} ${item.openAt.slice(0, 10)}→${item.closeAt.slice(0, 10)}`]));
  const change = (field: string, value: string) => onReviewChange(cycle.id, field, value);

  return <DetailFrame className="detail-dialog review-dialog" label={`${cycle.symbol} 四步交易復盤`} onClose={onClose}>
    <article className="cycle-detail-modal review-flow">
      <header className="panel-head detail-header">
        <div><p className="review-context">{cycle.openAt.slice(0, 10)} → {cycle.closeAt.slice(0, 10)}・內容自動儲存</p><h2>{cycle.symbol} 四步交易復盤 <span className={`direction ${cycle.direction.toLowerCase()}`}>{cycle.direction === "SHORT" ? "空" : "多"}</span></h2></div>
        <button type="button" className="close" aria-label="關閉視窗" onClick={onClose}>×</button>
      </header>

      <nav className="review-steps" aria-label="復盤步驟">
        {progress.steps.map((item: any, index: number) => <button type="button" key={item.id} aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}><span>{item.complete ? "✓" : index + 1}</span><b>{item.label}</b></button>)}
      </nav>

      <div className="review-step-body">
        {step === 0 && <section className="review-step" aria-labelledby="review-facts-title">
          <div className="review-step-heading"><div><h3 id="review-facts-title">先確認發生了什麼</h3></div><span>只呈現可追溯資料，不替你解釋動機。</span></div>
          {analysis.sameDay && <div className="precision-warning"><b>同日交易・日線近似</b><span>MAE／MFE 不可視為分鐘級正式結果。</span></div>}
          <dl className="review-fact-strip"><div><dt>損益</dt><dd className={cycle.pnl >= 0 ? "positive" : "negative"}>{money(cycle.pnl, cycle.currency)}</dd><small>{pct(cycle.returnPct)}</small></div><div><dt>持有</dt><dd>{analysis.holdingHours.toFixed(1)} 小時</dd><small>{analysis.tradingDays == null ? "交易日待行情" : `${analysis.tradingDays} 個交易日`}</small></div><div><dt>MAE／MFE</dt><dd>{pct(cycle.maePct)}／{pct(cycle.mfePct)}</dd><small>{analysis.precision}</small></div><div><dt>R 倍數</dt><dd>{analysis.rMultiple == null ? "—" : `${analysis.rMultiple.toFixed(2)}R`}</dd><small>{analysis.initialRisk == null ? "需事前停損" : `風險 ${money(analysis.initialRisk, cycle.currency)}`}</small></div></dl>
          <ReplayBoard cycle={cycle} marketBars={marketBars} planHistory={planHistory} review={review} rapidPairs={rapidPairs} decisionLinks={decisionLinks} strategies={strategies} strategyAssignments={strategyAssignments} entryContexts={entryContexts} onAddPlanVersion={onAddPlanVersion}/>
          <EntryContextEvidence contexts={entryContexts} cycleId={cycle.id}/>
          <details className="review-glossary"><summary>MAE、MFE、R 與點位分數怎麼看？</summary><dl><div><dt>MAE</dt><dd>持有期間最不利的價格波動；越負代表曾承受越深回撤。</dd></div><div><dt>MFE</dt><dd>持有期間最有利的價格波動；用來觀察曾經出現、但未必實現的機會。</dd></div><div><dt>R</dt><dd>實際損益相對事前風險的倍數；沒有事前停損時不計算。</dd></div><div><dt>點位分數</dt><dd>進出場價在可驗證價格區間的相對位置，不代表未來勝率。</dd></div></dl></details>
          <details className="review-evidence"><summary>查看 {cycle.fills.length} 筆原始成交</summary><div className="table-wrap" tabIndex={0} role="region" aria-label="原始成交資料表，可捲動"><table><thead><tr><th>時間</th><th>方向</th><th>數量</th><th>成交價</th><th>費用</th></tr></thead><tbody>{cycle.fills.map((fill: any) => <tr key={fill.id}><td>{localDateTime(fill.timestamp)}</td><td>{fill.side === "BUY" ? "買進" : "賣出"}</td><td>{fill.quantity}</td><td>{money(fill.price, fill.currency)}</td><td>{money(fill.fee || 0, fill.currency)}</td></tr>)}</tbody></table></div></details>
        </section>}

        {step === 1 && <section className="review-step" aria-labelledby="review-judgment-title">
          <div className="review-step-heading"><div><p>你的判斷</p><h3 id="review-judgment-title">進場與出場品質如何？</h3></div><span>先標記，再用一句話寫下如果重做會改哪裡。</span></div>
          <div className="cycle-quality-pickers"><QualityTagPicker cycle={cycle} kind="entry" value={review.entryQualityTag} onChange={(value) => change("entryQualityTag", value)}/><QualityTagPicker cycle={cycle} kind="exit" value={review.exitQualityTag} onChange={(value) => change("exitQualityTag", value)}/></div>
          <div className="cycle-review-form trade-point-review"><label>進場判斷<textarea value={review.entryReview || ""} placeholder="如果重做，我會等待哪個價位或訊號？" onChange={(event) => change("entryReview", event.target.value)}/></label><label>出場判斷<textarea value={review.exitReview || ""} placeholder="如果重做，我會在哪個條件減碼或出場？" onChange={(event) => change("exitReview", event.target.value)}/></label></div>
          <p className="review-save-note">標籤與文字都會背景儲存；最後評分：{localDateTime(review.qualityRatedAt)}。</p>
        </section>}

        {step === 2 && <section className="review-step" aria-labelledby="review-reason-title">
          <div className="review-step-heading"><div><p>找出原因</p><h3 id="review-reason-title">計畫、決定與結果在哪裡分岔？</h3></div><span>描述當時能知道的事，避免用事後價格替自己補理由。</span></div>
          <StrategyChecklist cycle={cycle} strategies={strategies} assignment={strategyAssignments[cycle.id]} phase="post" onAssign={onAssignStrategy} onCheck={onStrategyCheck}/>
          <div className="cycle-review-form"><label>事前計畫<textarea value={review.preTradePlan || ""} placeholder="進場前原本打算怎麼做？" onChange={(event) => change("preTradePlan", event.target.value)}/></label><label>失效條件<textarea value={review.invalidation || ""} placeholder="什麼證據出現時，原判斷就不成立？" onChange={(event) => change("invalidation", event.target.value)}/></label><label>實際出場理由<textarea value={review.exitReason || ""} placeholder="當下促使我出場的原因是…" onChange={(event) => change("exitReason", event.target.value)}/></label><label>事前停損價格<input type="number" min="0" step="any" value={review.plannedStop ?? ""} placeholder="未設定則不計算 R" onChange={(event) => change("plannedStop", event.target.value)}/></label><label>修訂停損價格<input type="number" min="0" step="any" value={review.revisedStop ?? ""} placeholder="用於計算規則修改成本" onChange={(event) => change("revisedStop", event.target.value)}/></label></div>
          {relatedPairs.length > 0 && <div className="review-decision-chain"><h4>快速買回與決策鏈</h4>{relatedPairs.map((pair: any) => { const pairKey = `${pair.previousCycleId}>${pair.nextCycleId}`; const linked = Boolean(decisionLinks[pairKey]?.linked); const versions = decisionLinkHistory.filter((event: any) => event.pairKey === pairKey).length; return <div key={pairKey}><span><b>{cycleNames[pair.previousCycleId]} ↔ {cycleNames[pair.nextCycleId]}</b><small>{pair.gapTradingDays} 個交易日內重新建倉・{versions} 次版本修改</small></span><button type="button" className={linked ? "ghost" : "primary"} onClick={() => onToggleDecisionLink(pairKey)}>{linked ? "解除決策鏈" : "連結決策鏈"}</button></div>; })}</div>}
        </section>}

        {step === 3 && <section className="review-step" aria-labelledby="review-experiment-title">
          <div className="review-step-heading"><div><p>帶到下一筆</p><h3 id="review-experiment-title">只選一個可以驗證的改善實驗</h3></div><span>把反省改寫成「什麼情況、採取什麼行動、如何判斷有改善」。</span></div>
          <label className="review-experiment-field">下一筆我要驗證<textarea value={review.reflection || ""} placeholder="例：未看到回測承接時不追價；接下來 5 筆記錄違規次數。" onChange={(event) => change("reflection", event.target.value)}/><small>建議包含觸發條件、行動與可計數指標。</small></label>
          <label className="review-tags-field">行為／策略標籤<input value={review.tags || ""} placeholder="例：突破、追價、停損延遲" onChange={(event) => change("tags", event.target.value)}/></label>
          <div className="review-completion"><div><span>{progress.completedCount}/4</span><b>{progress.complete ? "復盤已完整" : "仍可稍後補完"}</b></div><ul>{progress.steps.map((item: any) => <li key={item.id} className={item.complete ? "done" : ""}>{item.complete ? "✓" : "○"} {item.label}</li>)}</ul></div>
          <p className="review-save-note">最後更新：{localDateTime(review.updatedAt)}。未完成也可以先關閉，內容不會遺失。</p>
        </section>}
      </div>

      <footer className="review-step-actions"><button type="button" className="ghost" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}>上一步</button><span>第 {step + 1} 步，共 4 步</span>{step < 3 ? <button type="button" className="primary" onClick={() => setStep((current) => Math.min(3, current + 1))}>下一步</button> : <button type="button" className="primary" onClick={onClose}>{progress.complete ? "完成復盤" : "保存並關閉"}</button>}</footer>
    </article>
  </DetailFrame>;
}
