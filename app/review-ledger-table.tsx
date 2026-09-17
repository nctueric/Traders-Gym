/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildReviewLedgerMetrics, reviewHistoryRequests } from "@/lib/review-ledger.mjs";
import { ENTRY_QUALITY_TAGS, PROFIT_EXIT_QUALITY_TAGS } from "@/lib/quality-rating.mjs";

const columns = [
  ["cycle", "閉環"], ["pnl", "交易損益（＄）"], ["investment", "投入金額（＄）"],
  ["allocation", "投入時部位比（％）"], ["expectancy", "交易期望值"], ["entry", "進場評價"],
  ["exit", "出場評價"], ["follow", "進場後3日"], ["mae", "MAE"], ["mfe", "MFE留存"],
  ["post", "出場後5日"], ["chart", "K線"],
] as const;
type ColumnId = typeof columns[number][0];
const defaultOrder = columns.map(([id]) => id);
const orderKey = "traders-gym.review-columns.v1";
const titles = Object.fromEntries(columns);

const money = (value: number | null, currency = "USD") => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("zh-TW", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2 }).format(value);
const pct = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const signedPct = (value: number | null) => value == null ? "—" : `${value >= 0 ? "+" : ""}${pct(value)}`;
const label = (value: string, entry: boolean) => (entry ? ENTRY_QUALITY_TAGS : PROFIT_EXIT_QUALITY_TAGS).find(tag => tag.value === value)?.label || "未評";

export function ReviewLedgerTable({ dataset, cycles, lossSampleCycles, trades, fetchHistory, onSelectCycle }: { dataset: any; cycles: any[]; lossSampleCycles: any[]; trades: any[]; fetchHistory: typeof fetch; onSelectCycle: (id: string) => void }) {
  const [order, setOrder] = useState<ColumnId[]>(defaultOrder);
  const [dragging, setDragging] = useState<ColumnId | null>(null);
  const [target, setTarget] = useState<ColumnId | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const drag = useRef<{ id: ColumnId; x: number; moved: boolean } | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(orderKey) || "null");
      if (Array.isArray(saved)) {
        const valid = [...new Set(saved.filter((id): id is ColumnId => defaultOrder.includes(id)))];
        // Hydrate browser-only preferences after SSR without changing server markup.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOrder([...valid, ...defaultOrder.filter(id => !valid.includes(id))]);
      }
    } catch { /* Unavailable or invalid storage uses the default order. */ }
  }, []);
  function saveOrder(next: ColumnId[], message: string) {
    setOrder(next);
    try { localStorage.setItem(orderKey, JSON.stringify(next)); setAnnouncement(message); }
    catch { setAnnouncement(`${message}；瀏覽器無法保存設定，本次頁面仍可使用。`); }
  }
  function moveColumn(id: ColumnId, destination: ColumnId) {
    if (id === destination) return;
    const next = [...order];
    next.splice(next.indexOf(id), 1);
    next.splice(order.indexOf(destination), 0, id);
    saveOrder(next, `${titles[id]}已移至第 ${next.indexOf(id) + 1} 欄`);
  }
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
    <div className="column-order-toolbar"><span id="column-order-help">拖拉表頭調整順序；鍵盤可用左右方向鍵移動，Home／End 移至首尾。</span><button type="button" className="text-button" onClick={() => saveOrder(defaultOrder, "已還原預設欄位順序")}>還原欄位順序</button></div>
    <span className="column-order-announcement" role="status">{announcement}</span>
    {trades.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label="逐筆交易復盤表，可左右捲動"><table className="review-ledger-table"><thead><tr>{order.map(id => <th key={id} scope="col" data-column={id} className={target === id ? "column-drop-target" : dragging === id ? "column-dragging" : ""}>
      <button type="button" className="column-drag-handle" aria-label={`移動${titles[id]}欄位`} aria-describedby="column-order-help"
        onKeyDown={event => {
          if (event.key === "Escape") { drag.current = null; setDragging(null); setTarget(null); }
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = event.key === "Home" ? 0 : event.key === "End" ? order.length - 1 : order.indexOf(id) + (event.key === "ArrowLeft" ? -1 : 1);
          if (order[index]) moveColumn(id, order[index]);
        }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id, x: event.clientX, moved: false };
          setDragging(id);
        }}
        onPointerMove={event => {
          if (!drag.current) return;
          if (Math.abs(event.clientX - drag.current.x) > 5) drag.current.moved = true;
          if (!drag.current.moved) return;
          const wrap = event.currentTarget.closest(".table-wrap");
          const bounds = wrap?.getBoundingClientRect();
          if (wrap && bounds) { if (event.clientX > bounds.right - 40) wrap.scrollLeft += 24; else if (event.clientX < bounds.left + 40) wrap.scrollLeft -= 24; }
          const th = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLTableCellElement>("th[data-column]");
          setTarget(th?.closest("table") === event.currentTarget.closest("table") ? th?.dataset.column as ColumnId : null);
        }}
        onPointerUp={event => {
          const th = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLTableCellElement>("th[data-column]");
          if (drag.current?.moved && th?.closest("table") === event.currentTarget.closest("table")) moveColumn(id, th!.dataset.column as ColumnId);
          drag.current = null; setDragging(null); setTarget(null);
        }}
        onPointerCancel={() => { drag.current = null; setDragging(null); setTarget(null); }}
        onLostPointerCapture={() => { drag.current = null; setDragging(null); setTarget(null); }}>
        <svg width="12" height="16" viewBox="0 0 12 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 3h.01M8 3h.01M4 8h.01M8 8h.01M4 13h.01M8 13h.01" strokeLinecap="round" /></svg>{titles[id]}
      </button>
    </th>)}</tr></thead><tbody>
      {[...trades].sort((a, b) => b.closeDate.localeCompare(a.closeDate)).map(trade => {
        const m = metrics.rows[trade.cycleId];
        if (!m) return null;
        const cells = {
          cycle: <td key="cycle"><b>{trade.symbol}</b><small>{trade.direction === "SHORT" ? "空" : "多"}・{trade.openDate} → {trade.closeDate}</small></td>,
          pnl: <td key="pnl" className={m.pnl >= 0 ? "positive" : "negative"}>{money(m.pnl, m.currency)}</td>,
          investment: <td key="investment">{money(m.invested, m.currency)}</td>,
          allocation: <td key="allocation" className="allocation-cell"><b>{pct(m.allocation)}</b><small>{m.allocation == null ? "估值資料不足" : "日終估算"}</small><details><summary>估值說明</summary><div className="allocation-evidence"><p>最後投入日：{m.equity.date || "—"}</p><p>累計投入：{money(m.invested, m.currency)}</p><p>共用資金池總資產：{money(m.equity.total, "USD")}</p><p>投入美元等值：{money(m.investedUsd, "USD")}</p><p>美股與台股共用美元資金池。成交依成交日匯率計入現金，持倉依估值日匯率換算。</p><p>資產＝美元現金＋多頭市值－空頭負債；含當日全部成交及資金活動。</p>{m.equity.fxHistory?.length > 0 && <details><summary>採用的歷史匯率</summary>{m.equity.fxHistory.map((f: any) => <p key={f.date}>{f.date}：USDTWD {f.rate}</p>)}</details>}{m.equity.fx && <p>USDTWD：{m.equity.fx.rate}（{m.equity.fx.date}）</p>}{m.equity.prices.map((p: any) => <p key={p.symbol}>{p.symbol}：{p.close}（{p.date} 收盤）</p>)}{[...new Set([...m.equity.problems, ...m.equity.warnings, ...m.investmentProblems])].map((problem: string) => <p key={problem}>{problem}</p>)}</div></details></td>,
          expectancy: <td key="expectancy" className={m.expectancy == null ? "" : m.expectancy >= 0 ? "positive" : "negative"}>{m.expectancy == null ? "—" : `${m.expectancy >= 0 ? "+" : ""}${m.expectancy.toFixed(2)} 倍`}{m.expectancy == null && <small>{metrics.averageLoss == null ? "無虧損樣本" : "計算資料不足"}</small>}</td>,
          entry: <td key="entry">{label(trade.entryQualityTag, true)}</td>,
          exit: <td key="exit">{label(trade.exitQualityTag, false)}</td>,
          follow: <td key="follow" className={trade.entryFollowThrough3 == null ? "" : trade.entryFollowThrough3 >= 0 ? "positive" : "negative"}>{signedPct(trade.entryFollowThrough3)}</td>,
          mae: <td key="mae" className={trade.maePct != null && trade.maePct < -0.1 ? "negative" : ""}>{signedPct(trade.maePct)}</td>,
          mfe: <td key="mfe">{signedPct(trade.mfeRetention)}</td>,
          post: <td key="post" className={trade.postExit5 != null && trade.postExit5 > 0.03 ? "negative" : ""}>{signedPct(trade.postExit5)}</td>,
          chart: <td key="chart"><button type="button" className="ghost" aria-label={`查看 ${trade.symbol} ${trade.closeDate} 的K線與復盤`} onClick={() => onSelectCycle(trade.cycleId)}>看 K 線與復盤</button></td>
        };
        return <tr key={trade.cycleId}>{order.map(id => cells[id])}</tr>;
      })}
    </tbody></table></div> : <div className="mini-empty">這個期間尚無完整交易閉環可分析。</div>}
  </section>;
}
