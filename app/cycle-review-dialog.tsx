/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { analyzeCycle } from "@/lib/review-engine.mjs";
import { cycleReviewProgress } from "@/lib/review-flow.mjs";
import { DialogFrame } from "./workspace-ui";
import { QualityTagSelect } from "./quality-rating-control";
import { StrategyChecklist } from "./strategy-workspace";
import { ReplayBoard } from "./training-workspace";

function pct(value: number | null) { return value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`; }
function money(value: number, currency = "USD") { return new Intl.NumberFormat("zh-TW", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2 }).format(value); }
function localDateTime(value?: string) { return value ? new Date(value).toLocaleString("zh-TW", { hour12: false }) : "尚未設定"; }

export function CycleReviewDialog({ entryContexts, cycle, marketBars, review, planHistory, rapidPairs, decisionLinks, strategies, strategyAssignments, onAssignStrategy, onStrategyCheck, onAddPlanVersion, onReviewChange, onClose }: any) {
  const analysis = analyzeCycle(cycle, marketBars, review);
  const progress = cycleReviewProgress(review);
  const change = (field: string, value: string) => onReviewChange(cycle.id, field, value);

  return <DialogFrame className="detail-dialog review-dialog" label={`${cycle.symbol} 交易復盤`} onClose={onClose}>
    <article className="cycle-detail-modal review-flow single-page-review">
      <header className="panel-head detail-header">
        <div><h2>{cycle.symbol} 交易復盤 <span className={`direction ${cycle.direction.toLowerCase()}`}>{cycle.direction === "SHORT" ? "空" : "多"}</span></h2><p className="review-context">{cycle.openAt.slice(0, 10)} → {cycle.closeAt.slice(0, 10)}・內容自動儲存</p></div>
        <button type="button" className="close" aria-label="關閉視窗" onClick={onClose}>×</button>
      </header>
      <section className="review-overview" aria-label="交易摘要與 K 線">
          <dl className="review-fact-strip"><div><dt>損益</dt><dd className={cycle.pnl >= 0 ? "positive" : "negative"}>{money(cycle.pnl, cycle.currency)}</dd><small>{pct(cycle.returnPct)}</small></div><div><dt>持有</dt><dd>{analysis.holdingHours.toFixed(1)} 小時</dd><small>{analysis.tradingDays == null ? "交易日待行情" : `${analysis.tradingDays} 個交易日`}</small></div><div><dt>MAE／MFE</dt><dd>{pct(cycle.maePct)}／{pct(cycle.mfePct)}</dd><small>{analysis.precision}</small></div><div><dt>R 倍數</dt><dd>{analysis.rMultiple == null ? "—" : `${analysis.rMultiple.toFixed(2)}R`}</dd><small>{analysis.initialRisk == null ? "需事前停損" : `風險 ${money(analysis.initialRisk, cycle.currency)}`}</small></div></dl>
          <ReplayBoard cycle={cycle} marketBars={marketBars} planHistory={planHistory} review={review} rapidPairs={rapidPairs} decisionLinks={decisionLinks} strategies={strategies} strategyAssignments={strategyAssignments} entryContexts={entryContexts} onAddPlanVersion={onAddPlanVersion} showPlanEditor={false} showEntryEvidence={false}/>
      </section>
      <section className="review-judgment" aria-labelledby="review-judgment-title">
        <h3 id="review-judgment-title">進出場判斷</h3>
        <div className="review-quality-selects">
          <QualityTagSelect cycle={cycle} kind="entry" value={review.entryQualityTag} onChange={(value) => change("entryQualityTag", value)}/>
          <QualityTagSelect cycle={cycle} kind="exit" value={review.exitQualityTag} onChange={(value) => change("exitQualityTag", value)}/>
        </div>
        <p className="review-save-note">選擇後自動儲存・最後評分：{localDateTime(review.qualityRatedAt)}</p>
      </section>
      <StrategyChecklist cycle={cycle} strategies={strategies} assignment={strategyAssignments[cycle.id]} phase="post" compact onAssign={onAssignStrategy} onCheck={onStrategyCheck}/>
      <div className="review-reference">
          <details className="review-glossary"><summary>MAE、MFE、R 與點位分數怎麼看？</summary><dl><div><dt>MAE</dt><dd>持有期間最不利的價格波動；越負代表曾承受越深回撤。</dd></div><div><dt>MFE</dt><dd>持有期間最有利的價格波動；用來觀察曾經出現、但未必實現的機會。</dd></div><div><dt>R</dt><dd>實際損益相對事前風險的倍數；沒有事前停損時不計算。</dd></div><div><dt>點位分數</dt><dd>進出場價在可驗證價格區間的相對位置，不代表未來勝率。</dd></div></dl></details>
          <details className="review-evidence"><summary>查看 {cycle.fills.length} 筆原始成交</summary><div className="table-wrap" tabIndex={0} role="region" aria-label="原始成交資料表，可捲動"><table><thead><tr><th>時間</th><th>方向</th><th>數量</th><th>成交價</th><th>費用</th></tr></thead><tbody>{cycle.fills.map((fill: any) => <tr key={fill.id}><td>{localDateTime(fill.timestamp)}</td><td>{fill.side === "BUY" ? "買進" : "賣出"}</td><td>{fill.quantity}</td><td>{money(fill.price, fill.currency)}</td><td>{money(fill.fee || 0, fill.currency)}</td></tr>)}</tbody></table></div></details>
      </div>
      <footer className="review-close-actions"><span role="status">{progress.complete ? "進出場判斷已完成" : `已評 ${progress.completedCount}/2，可稍後補完`}</span><button type="button" className="primary" onClick={onClose}>{progress.complete ? "完成復盤" : "關閉"}</button></footer>
    </article>
  </DialogFrame>;
}
