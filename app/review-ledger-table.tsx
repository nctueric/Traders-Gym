/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildReviewLedgerMetrics, reviewHistoryRequests } from "@/lib/review-ledger.mjs";
import { reviewCacheKey, scopedReviewMetrics, validReviewCache, REVIEW_CACHE_VERSION } from "@/lib/review-cache.mjs";
import { ENTRY_QUALITY_TAGS, PROFIT_EXIT_QUALITY_TAGS } from "@/lib/quality-rating.mjs";

const columns = [
  ["cycle", "閉環"], ["pnl", "交易損益（＄）"], ["return", "交易損益率"], ["days", "持倉時間（交易日）"], ["investment", "投入金額（＄）"],
  ["allocation", "投入時部位比（％）"], ["expectancy", "交易期望值"], ["entry", "進場評價"],
  ["exit", "出場評價"], ["follow", "進場後3日"], ["mae", "MAE"], ["mfe", "MFE"],
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

export function ReviewLedgerTable({ accountId = "", allCycles, dataset, cycles, lossSampleCycles, trades, fetchHistory, onSelectCycle }: { accountId?: string; allCycles?: any[]; dataset: any; cycles: any[]; lossSampleCycles: any[]; trades: any[]; fetchHistory: typeof fetch; onSelectCycle: (id: string) => void }) {
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
        for (const id of defaultOrder) { if (!valid.includes(id)) { const prior = defaultOrder[defaultOrder.indexOf(id)-1]; valid.splice(prior && valid.includes(prior) ? valid.indexOf(prior)+1 : valid.length,0,id); } }
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOrder(valid);
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
  const [state, setState] = useState("");
  const [retry, setRetry] = useState(0);
  const refreshRequested = useRef(false);
  const [cachedRows, setCachedRows] = useState<Record<string, any>>({});
  const valuationCycles = allCycles || cycles;
  const input = useMemo(() => ({accounts:dataset.accounts, fills:dataset.fills, cashActivities:dataset.cashActivities, marketBars:dataset.marketBars}), [dataset.accounts,dataset.fills,dataset.cashActivities,dataset.marketBars]);
  const valuationInput = useMemo(() => JSON.stringify({input, cycles: valuationCycles.map(c => ({id:c.id,pnl:c.pnl,entryNotional:c.entryNotional,mfePct:c.mfePct,currency:c.currency,direction:c.direction,fills:c.fills,openAt:c.openAt,closeAt:c.closeAt,symbol:c.symbol,market:c.market,exchange:c.exchange}))}),[input,valuationCycles]);
  useEffect(() => {
    const {input,cycles:valuationCycles} = JSON.parse(valuationInput);
    const controller = new AbortController();
    const forceRefresh = refreshRequested.current; refreshRequested.current = false;
    const load = async () => {
      setState("讀取雲端歷史估值…");
      setCachedRows({});
      const key = await reviewCacheKey(input, valuationCycles);
      if (controller.signal.aborted) return;
      const url = `/api/review-valuations?${new URLSearchParams({accountId,key})}`;
      if (accountId && !forceRefresh) {
        try {
          const response = await fetchHistory(url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
          if(response.ok) {
            const saved = await response.json();
            if(validReviewCache(saved,key) && valuationCycles.every((c:any) => saved.rows[c.id])) {
              if(controller.signal.aborted)return;
              setCachedRows(saved.rows);setState(`已讀取雲端估值 · ${new Date(saved.savedAt).toLocaleString("zh-TW")}`);return;
            }
          }
        } catch { if(controller.signal.aborted)return; }
      }
      const bars: any[] = []; let failed = 0;
      const targets = reviewHistoryRequests(input, valuationCycles);
      for (const [i,target] of targets.entries()) {
        if(controller.signal.aborted)return;
        setState(`歷史估值資料 ${i+1}/${targets.length}`);
        try {
          const response = await fetchHistory(`/api/history?${new URLSearchParams({...target,datasetSymbol:target.symbol,mode:"close"})}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
          if(!response.ok)throw new Error();
          const payload=await response.json();
          if(!Array.isArray(payload.bars)||!payload.bars.length)throw new Error();
          bars.push(...payload.bars.map((bar:any)=>({...bar,symbol:target.symbol,providerSymbol:target.symbol})));
        } catch {if(controller.signal.aborted)return;failed++;}
      }
      if(controller.signal.aborted)return;
      const result=buildReviewLedgerMetrics(input,valuationCycles,valuationCycles,bars);
      setCachedRows(result.rows);
      if(failed){setState(`${failed} 個標的歷史資料未取得，可重試；未保存不完整估值。`);return;}
      if(!accountId){setState("歷史估值資料已更新");return;}
      try {
        const response=await fetchHistory(url,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:REVIEW_CACHE_VERSION,key,savedAt:new Date().toISOString(),rows:result.rows}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        if(!response.ok)throw new Error();
        if(!controller.signal.aborted)setState("歷史估值已儲存至雲端");
      } catch {if(!controller.signal.aborted)setState("估值可用，雲端保存失敗；可重試。");}
    };
    void load().catch(()=>{if(!controller.signal.aborted)setState("歷史估值讀取失敗，可重試。");});
    return ()=>controller.abort();
  },[valuationInput,accountId,fetchHistory,retry]);
  const metrics = useMemo(()=>scopedReviewMetrics(cachedRows,lossSampleCycles),[cachedRows,lossSampleCycles]);
  return <section className="quality-ledger" id="quick-rating" tabIndex={-1}>
    <div className="panel-head"><div><h2>逐筆交易復盤</h2><p className="muted">評價顯示已保存的判斷；點「看 K 線與復盤」修改。</p></div><div className="review-history-status"><span role="status">{state}</span>{<button type="button" className="text-button" onClick={() => {refreshRequested.current=true;setRetry(n => n + 1);}}>{state.includes("失敗") || state.includes("未取得") ? "重試估值" : "重新整理估值"}</button>}</div></div>
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
          return: <td key="return" className={m.returnPct == null ? "" : m.returnPct >= 0 ? "positive" : "negative"}>{signedPct(m.returnPct)}</td>,
          days: <td key="days" title="依個股日 K 日期計數，進出場日皆計入">{m.holdingTradingDays == null ? "—（缺日線資料）" : `${m.holdingTradingDays} 日`}</td>,
          investment: <td key="investment">{money(m.invested, m.currency)}</td>,
          allocation: <td key="allocation" className="allocation-cell"><b>{pct(m.allocation)}</b><small>{m.allocation == null ? "估值資料不足" : "日終估算"}</small><details><summary>估值說明</summary><div className="allocation-evidence"><p>最後投入日：{m.equity.date || "—"}</p><p>累計投入：{money(m.invested, m.currency)}</p><p>共用資金池總資產：{money(m.equity.total, "USD")}</p><p>投入美元等值：{money(m.investedUsd, "USD")}</p><p>美股與台股共用美元資金池。成交依成交日匯率計入現金，持倉依估值日匯率換算。</p><p>資產＝美元現金＋多頭市值－空頭負債；含當日全部成交及資金活動。</p>{m.equity.fxHistory?.length > 0 && <details><summary>採用的歷史匯率</summary>{m.equity.fxHistory.map((f: any) => <p key={f.date}>{f.date}：USDTWD {f.rate}</p>)}</details>}{m.equity.fx && <p>USDTWD：{m.equity.fx.rate}（{m.equity.fx.date}）</p>}{m.equity.prices.map((p: any) => <p key={p.symbol}>{p.symbol}：{p.close}（{p.date} 收盤）</p>)}{[...new Set([...m.equity.problems, ...m.equity.warnings, ...m.investmentProblems])].map((problem: string) => <p key={problem}>{problem}</p>)}</div></details></td>,
          expectancy: <td key="expectancy" className={m.expectancy == null ? "" : m.expectancy >= 0 ? "positive" : "negative"}>{m.expectancy == null ? "—" : `${m.expectancy >= 0 ? "+" : ""}${m.expectancy.toFixed(2)} 倍`}{m.expectancy == null && <small>{metrics.averageLoss == null ? "無虧損樣本" : "計算資料不足"}</small>}</td>,
          entry: <td key="entry">{label(trade.entryQualityTag, true)}</td>,
          exit: <td key="exit">{label(trade.exitQualityTag, false)}</td>,
          follow: <td key="follow" className={trade.entryFollowThrough3 == null ? "" : trade.entryFollowThrough3 >= 0 ? "positive" : "negative"}>{signedPct(trade.entryFollowThrough3)}</td>,
          mae: <td key="mae" className={trade.maePct != null && trade.maePct < -0.1 ? "negative" : ""}>{signedPct(trade.maePct)}</td>,
          mfe: <td key="mfe">{signedPct(m.mfePct)}</td>,
          post: <td key="post" className={trade.postExit5 != null && trade.postExit5 > 0.03 ? "negative" : ""}>{signedPct(trade.postExit5)}</td>,
          chart: <td key="chart"><button type="button" className="ghost" aria-label={`查看 ${trade.symbol} ${trade.closeDate} 的K線與復盤`} onClick={() => onSelectCycle(trade.cycleId)}>看 K 線與復盤</button></td>
        };
        return <tr key={trade.cycleId}>{order.map(id => cells[id])}</tr>;
      })}
    </tbody></table></div> : <div className="mini-empty">這個期間尚無完整交易閉環可分析。</div>}
  </section>;
}
