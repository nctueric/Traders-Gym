/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildReviewLedgerMetrics, reviewHistoryRequests } from "@/lib/review-ledger.mjs";
import { ENTRY_QUALITY_TAGS, PROFIT_EXIT_QUALITY_TAGS } from "@/lib/quality-rating.mjs";

const money = (value: number | null, currency = "USD") => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("zh-TW", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2 }).format(value);
const pct = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const signedPct = (value: number | null) => value == null ? "—" : `${value >= 0 ? "+" : ""}${pct(value)}`;
const label = (value: string, entry: boolean) => (entry ? ENTRY_QUALITY_TAGS : PROFIT_EXIT_QUALITY_TAGS).find(tag => tag.value === value)?.label || "未評";

export function ReviewLedgerTable({ dataset, cycles, lossSampleCycles, trades, fetchHistory, onSelectCycle }: { dataset: any; cycles: any[]; lossSampleCycles: any[]; trades: any[]; fetchHistory: typeof fetch; onSelectCycle: (id: string) => void }) {
  const [history, setHistory] = useState<Record<string, any[]>>({});
  const [state, setState] = useState("");
  const [retry, setRetry] = useState(0);
  const completed = useRef(new Set<string>());
  const requestKey = JSON.stringify(reviewHistoryRequests(dataset, cycles));
  useEffect(() => {
    const controller = new AbortController();
    const targets = (JSON.parse(requestKey) as { symbol: string; start: string; end: string }[]).filter(t => !completed.current.has(JSON.stringify(t)));
    if (!targets.length) return;
    const load = async () => {
      let failed = 0;
      for (const [i, target] of targets.entries()) {
        if (controller.signal.aborted) return;
        setState(`歷史估值資料 ${i + 1}/${targets.length}`);
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), 15000);
        try {
          const params = new URLSearchParams({ ...target, datasetSymbol: target.symbol, mode: "close" });
          const response = await fetchHistory(`/api/history?${params}`, { signal: AbortSignal.any([controller.signal, timeout.signal]) });
          if (!response.ok) throw new Error("歷史行情讀取失敗");
          const payload = await response.json();
          if (!Array.isArray(payload.bars) || !payload.bars.length) throw new Error("無歷史行情");
          if (controller.signal.aborted) return;
          const bars = payload.bars.map((bar: any) => ({ ...bar, symbol: target.symbol, providerSymbol: target.symbol }));
          setHistory(current => ({ ...current, [JSON.stringify(target)]: bars }));
          completed.current.add(JSON.stringify(target));
        } catch {
          if (controller.signal.aborted) return;
          failed++;
        } finally { clearTimeout(timer); }
      }
      if (!controller.signal.aborted) setState(failed ? `${failed} 個標的歷史資料未取得，可重試；可用資料仍顯示日期。` : "歷史估值資料已更新");
    };
    void load();
    return () => controller.abort();
  }, [requestKey, fetchHistory, retry]);
  const bars = useMemo(() => Object.values(history).flat(), [history]);
  const metrics = useMemo(() => buildReviewLedgerMetrics(dataset, cycles, lossSampleCycles, bars), [dataset, cycles, lossSampleCycles, bars]);
  return <section className="quality-ledger" id="quick-rating" tabIndex={-1}>
    <div className="panel-head"><div><h2>逐筆交易復盤</h2><p className="muted">評價顯示已保存的判斷；點「看 K 線與復盤」修改。</p></div><div className="review-history-status"><span role="status">{state}</span>{state.includes("未取得") && <button type="button" className="text-button" onClick={() => setRetry(n => n + 1)}>重試缺漏行情</button>}</div></div>
    <p className="review-ledger-method">交易期望值＝實際損益率 ÷ 平均虧損率絕對值，為逐筆相對倍數，非整體交易期望值。篩選範圍內 {metrics.lossCount} 筆虧損交易，平均虧損率 {metrics.averageLoss == null ? "—（無虧損樣本）" : pct(metrics.averageLoss)}；不受顯示筆數限制。</p>
    {trades.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label="逐筆交易復盤表，可左右捲動"><table className="review-ledger-table"><thead><tr>{["閉環", "交易損益（＄）", "投入金額（＄）", "投入時部位比（％）", "交易期望值", "進場評價", "出場評價", "進場後3日", "MAE", "MFE留存", "出場後5日", "K線"].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead><tbody>
      {[...trades].sort((a, b) => b.closeDate.localeCompare(a.closeDate)).map(trade => {
        const m = metrics.rows[trade.cycleId];
        if (!m) return null;
        return <tr key={trade.cycleId}>
          <td><b>{trade.symbol}</b><small>{trade.direction === "SHORT" ? "空" : "多"}・{trade.openDate} → {trade.closeDate}</small></td>
          <td className={m.pnl >= 0 ? "positive" : "negative"}>{money(m.pnl, m.currency)}</td><td>{money(m.invested, m.currency)}</td>
          <td className="allocation-cell"><b>{pct(m.allocation)}</b><small>{m.allocation == null ? "估值資料不足" : "日終估算"}</small><details><summary>估值說明</summary><div className="allocation-evidence"><p>最後投入日：{m.equity.date || "—"}</p><p>累計投入：{money(m.invested, m.currency)}</p><p>共用資金池總資產：{money(m.equity.total, "USD")}</p><p>投入美元等值：{money(m.investedUsd, "USD")}</p><p>美股與台股共用美元資金池。成交依成交日匯率計入現金，持倉依估值日匯率換算。</p><p>資產＝美元現金＋多頭市值－空頭負債；含當日全部成交及資金活動。</p>{m.equity.fxHistory?.length > 0 && <details><summary>採用的歷史匯率</summary>{m.equity.fxHistory.map((f: any) => <p key={f.date}>{f.date}：USDTWD {f.rate}</p>)}</details>}{m.equity.fx && <p>USDTWD：{m.equity.fx.rate}（{m.equity.fx.date}）</p>}{m.equity.prices.map((p: any) => <p key={p.symbol}>{p.symbol}：{p.close}（{p.date} 收盤）</p>)}{[...new Set([...m.equity.problems, ...m.equity.warnings, ...m.investmentProblems])].map((problem: string) => <p key={problem}>{problem}</p>)}</div></details></td>
          <td className={m.expectancy == null ? "" : m.expectancy >= 0 ? "positive" : "negative"}>{m.expectancy == null ? "—" : `${m.expectancy >= 0 ? "+" : ""}${m.expectancy.toFixed(2)} 倍`}{m.expectancy == null && <small>{metrics.averageLoss == null ? "無虧損樣本" : "計算資料不足"}</small>}</td>
          <td>{label(trade.entryQualityTag, true)}</td><td>{label(trade.exitQualityTag, false)}</td>
          <td className={trade.entryFollowThrough3 == null ? "" : trade.entryFollowThrough3 >= 0 ? "positive" : "negative"}>{signedPct(trade.entryFollowThrough3)}</td><td className={trade.maePct != null && trade.maePct < -0.1 ? "negative" : ""}>{signedPct(trade.maePct)}</td><td>{signedPct(trade.mfeRetention)}</td><td className={trade.postExit5 != null && trade.postExit5 > 0.03 ? "negative" : ""}>{signedPct(trade.postExit5)}</td>
          <td><button type="button" className="ghost" aria-label={`查看 ${trade.symbol} ${trade.closeDate} 的K線與復盤`} onClick={() => onSelectCycle(trade.cycleId)}>看 K 線與復盤</button></td>
        </tr>;
      })}
    </tbody></table></div> : <div className="mini-empty">這個期間尚無完整交易閉環可分析。</div>}
  </section>;
}
