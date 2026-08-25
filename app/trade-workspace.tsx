/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runSelfTests, STORAGE_KEY, summarize } from "@/lib/trade-engine.mjs";
import { isQuoteStale, mergeMarketBars, pnlToUsd, QUOTE_REFRESH_MS, toProviderSymbol, USDTWD_SYMBOL } from "@/lib/quote-engine.mjs";
import { classifyCashActivities, importTradingViewCsv } from "@/lib/trader-x2-importer.mjs";
import { buildWeeklyEquitySeries, buildWeeklyPerformance, monthlyAssetChange, monthlyCycleScore } from "@/lib/portfolio-engine.mjs";

type Fill = { id: string; accountId: string; symbol: string; market: string; currency: string; side: "BUY" | "SELL"; quantity: number; price: number; fee: number; timestamp: string; note?: string };
type CashActivity = { id: string; type: string; amount: number; timestamp: string; accountId: string | null; currency: string | null; requiresReview?: boolean; source?: string };
type Dataset = { version: string; profile: { name: string; baseCurrency: string; costMethod: string }; accounts: { id: string; name: string; currency: string }[]; fills: Fill[]; cashActivities?: CashActivity[]; marketBars: Record<string, unknown>[]; settings: { quoteProvider: string; benchmarkSymbol?: string }; source?: { fileName?: string; format?: string } };
type Quote = { symbol: string; price: number; previousClose: number | null; changePct: number | null; currency: string; marketState: string; updatedAt: string; source: string };
type HistoryBar = { symbol: string; date: string; close: number; open?: number; high?: number; low?: number; volume?: number | null };
type PendingImport = { dataset: Dataset; fileName: string; kind: "JSON" | "TradingView CSV"; duplicateCount: number; warnings: string[] };

const emptyData: Dataset = { version: "0.1.0", profile: { name: "我的交易帳本", baseCurrency: "USD", costMethod: "FIFO" }, accounts: [{ id: "main", name: "主要帳戶", currency: "USD" }], fills: [], cashActivities: [], marketBars: [], settings: { quoteProvider: "json", benchmarkSymbol: "SPY" } };
const demoData: Dataset = { ...emptyData, fills: [
  { id: "nvts-buy", accountId: "main", symbol: "NVTS", market: "NASDAQ", currency: "USD", side: "BUY", quantity: 100, price: 10, fee: 1, timestamp: "2026-07-01T09:30:00Z", note: "示範資料" },
  { id: "nvts-sell", accountId: "main", symbol: "NVTS", market: "NASDAQ", currency: "USD", side: "SELL", quantity: 100, price: 12.5, fee: 1, timestamp: "2026-07-10T09:30:00Z" },
  { id: "wday-buy", accountId: "main", symbol: "WDAY", market: "NASDAQ", currency: "USD", side: "BUY", quantity: 20, price: 200, fee: 1, timestamp: "2026-08-01T09:30:00Z" },
], marketBars: [
  { symbol: "NVTS", date: "2026-07-02", open: 10, high: 11, low: 9, close: 10.7 },
  { symbol: "NVTS", date: "2026-07-08", open: 11, high: 13.2, low: 10.5, close: 12.8 },
  { symbol: "WDAY", date: "2026-08-04", open: 201, high: 210, low: 196, close: 205 },
] };

function pct(value: number | null) { return value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`; }
function money(value: number, currency = "USD") { return new Intl.NumberFormat("zh-TW", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
function moneyByCurrency(values: Record<string, number>) { const rows = Object.entries(values).filter(([, value]) => Math.abs(value) > 1e-9); return rows.length ? rows.map(([currency, value]) => money(value, currency)).join(" · ") : money(0); }
function addCurrencyValues(...groups: Record<string, number>[]) { return groups.reduce<Record<string, number>>((result, group) => { Object.entries(group).forEach(([currency, value]) => { result[currency] = (result[currency] || 0) + value; }); return result; }, {}); }
function currentMonthKey(now = new Date()) { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).formatToParts(now); return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`; }
function cycleHistoryTargets(cycles: any[]) {
  const grouped = new Map<string, { symbol: string; market: string; start: string; end: string }>();
  for (const cycle of cycles) {
    const key = `${cycle.market || ""}:${cycle.symbol}`;
    const start = cycle.openAt.slice(0, 10);
    const end = cycle.closeAt.slice(0, 10);
    const current = grouped.get(key);
    grouped.set(key, { symbol: cycle.symbol, market: cycle.market || "", start: current && current.start < start ? current.start : start, end: current && current.end > end ? current.end : end });
  }
  return [...grouped.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export default function TradeWorkspace() {
  const [data, setData] = useState<Dataset>(() => { if (typeof window !== "undefined") { const saved = localStorage.getItem(STORAGE_KEY); if (saved) { try { return JSON.parse(saved); } catch (error) { console.warn("無法恢復本機交易資料", error); } } } return demoData; });
  const [tab, setTab] = useState("overview");
  const [message, setMessage] = useState("資料已從本機或示範檔載入；可匯入 JSON 或 TradingView CSV 覆蓋。");
  const [dialog, setDialog] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [cashCurrency, setCashCurrency] = useState("USD");
  const benchmarkSymbol = data.settings?.benchmarkSymbol || "SPY";
  const [benchmarkInput, setBenchmarkInput] = useState(benchmarkSymbol);
  const [benchmarkBars, setBenchmarkBars] = useState<HistoryBar[]>([]);
  const [benchmarkState, setBenchmarkState] = useState("準備讀取 ETF 歷史行情");
  const [cycleHistoryState, setCycleHistoryState] = useState("準備同步閉環日線");
  const [cycleHistoryRefresh, setCycleHistoryRefresh] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Fill>({ id: "", accountId: "main", symbol: "", market: "NASDAQ", currency: "USD", side: "BUY", quantity: 1, price: 0, fee: 0, timestamp: new Date().toISOString().slice(0, 16), note: "" });

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }, [data]);
  const report = useMemo(() => summarize(data), [data]);
  const tests = useMemo(() => runSelfTests(), []);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [quoteState, setQuoteState] = useState("準備更新");
  const [lastQuoteAt, setLastQuoteAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const quoteTargets = useMemo(() => [...new Set([...report.positions.map((position: any) => toProviderSymbol(position.symbol, position.market)), USDTWD_SYMBOL])], [report.positions]);
  const quoteKey = quoteTargets.join(",");
  const cycleHistoryKey = JSON.stringify(cycleHistoryTargets(report.cycles));

  useEffect(() => { const ticker = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(ticker); }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(quoteKey)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!active) return;
        setQuotes(Object.fromEntries(payload.quotes.map((quote: Quote) => [quote.symbol, quote])));
        setLastQuoteAt(Date.now());
        setQuoteState(payload.errors?.length ? `${payload.errors.length} 個報價更新失敗` : "即時報價已更新");
      } catch (error) { if (active) setQuoteState(`更新失敗：${error instanceof Error ? error.message : "未知錯誤"}`); }
    };
    refresh();
    const timer = window.setInterval(refresh, QUOTE_REFRESH_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [quoteKey]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setBenchmarkState(`正在讀取 ${benchmarkSymbol}…`);
      try {
        const response = await fetch(`/api/history?symbol=${encodeURIComponent(benchmarkSymbol)}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        if (!active) return;
        setBenchmarkBars(payload.bars || []);
        setBenchmarkState(`${benchmarkSymbol} 已更新・${payload.bars?.length || 0} 個交易日`);
      } catch (error) {
        if (!active) return;
        setBenchmarkBars([]);
        setBenchmarkState(`ETF 行情失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
      }
    };
    load();
    return () => { active = false; };
  }, [benchmarkSymbol]);

  useEffect(() => {
    let active = true;
    const targets = JSON.parse(cycleHistoryKey) as { symbol: string; market: string; start: string; end: string }[];
    const load = async () => {
      if (!targets.length) { setCycleHistoryState("尚無交易閉環"); return; }
      setCycleHistoryState(`正在同步 ${targets.length} 個標的的 OHLC 日線…`);
      const rows = await Promise.all(targets.map(async (target) => {
        const providerSymbol = toProviderSymbol(target.symbol, target.market);
        const params = new URLSearchParams({ symbol: providerSymbol, datasetSymbol: target.symbol, start: target.start, end: target.end, mode: "ohlc" });
        try {
          const response = await fetch(`/api/history?${params}`, { cache: "no-store" });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
          return { bars: payload.bars as HistoryBar[], error: null };
        } catch (error) {
          return { bars: [] as HistoryBar[], error: `${target.symbol}：${error instanceof Error ? error.message : "讀取失敗"}` };
        }
      }));
      if (!active) return;
      const bars = rows.flatMap((row) => row.bars);
      const errors = rows.flatMap((row) => row.error ? [row.error] : []);
      if (bars.length) setData((current) => ({ ...current, marketBars: mergeMarketBars(current.marketBars || [], bars) }));
      setCycleHistoryState(errors.length ? `已更新 ${targets.length - errors.length}/${targets.length} 個標的；${errors.length} 個失敗` : `已更新 ${targets.length} 個標的・${bars.length} 筆日線`);
    };
    load();
    return () => { active = false; };
  }, [cycleHistoryKey, cycleHistoryRefresh]);

  const nextRefresh = lastQuoteAt == null ? 0 : Math.max(0, Math.ceil((QUOTE_REFRESH_MS - (clock - lastQuoteAt)) / 1000));
  const fxQuote = quotes[USDTWD_SYMBOL];
  const fxStale = !fxQuote || isQuoteStale(fxQuote.updatedAt, clock);
  const fxRate = !fxStale && fxQuote.price > 0 ? fxQuote.price : null;
  const unrealizedByCurrency = useMemo(() => report.positions.reduce<Record<string, number>>((result: Record<string, number>, position: any) => {
    const quote = quotes[toProviderSymbol(position.symbol, position.market)];
    if (!quote) return result;
    const direction = position.direction === "SHORT" ? -1 : 1;
    result[position.currency] = (result[position.currency] || 0) + (quote.price - position.averageCost) * position.quantity * direction;
    return result;
  }, {}), [quotes, report.positions]);
  const totalPnlByCurrency = useMemo(() => addCurrencyValues(report.realizedPnlByCurrency, unrealizedByCurrency), [report.realizedPnlByCurrency, unrealizedByCurrency]);
  const realizedUsd = pnlToUsd(report.realizedPnlByCurrency, fxRate);
  const totalUsd = pnlToUsd(totalPnlByCurrency, fxRate);
  const weeklyEquity = useMemo(() => buildWeeklyEquitySeries(data, fxQuote?.price > 0 ? fxQuote.price : null), [data, fxQuote]);
  const weeklyPerformance = useMemo(() => buildWeeklyPerformance(weeklyEquity, benchmarkBars), [weeklyEquity, benchmarkBars]);
  const monthKey = currentMonthKey();
  const monthScore = useMemo(() => monthlyCycleScore(report.cycles, monthKey), [report.cycles, monthKey]);
  const monthAssetDelta = useMemo(() => monthlyAssetChange(weeklyEquity, monthKey), [weeklyEquity, monthKey]);

  async function prepareImport(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      const looksJson = file.name.toLowerCase().endsWith(".json") || text.trimStart().startsWith("{");
      let parsed = looksJson ? JSON.parse(text) : importTradingViewCsv(text, file.name);
      if (!looksJson) {
        const symbols = new Set(parsed.fills.map((fill: Fill) => fill.symbol));
        parsed = { ...parsed, marketBars: (data.marketBars || []).filter((bar: any) => symbols.has(bar.symbol)) };
      }
      const checked = summarize(parsed);
      const errors = checked.issues.filter((issue: any) => issue.level === "error");
      if (errors.length) throw new Error(errors.map((issue: any) => issue.message).join("；"));
      const currentIds = new Set(data.fills.map((fill) => fill.id));
      setPendingImport({ dataset: parsed, fileName: file.name, kind: looksJson ? "JSON" : "TradingView CSV", duplicateCount: parsed.fills.filter((fill: Fill) => currentIds.has(fill.id)).length, warnings: checked.issues.filter((issue: any) => issue.level !== "error").map((issue: any) => issue.message) });
      setCashCurrency("USD");
      setMessage(`已讀取 ${file.name}，請確認匯入摘要。`);
    } catch (error) { setMessage(`匯入失敗：${error instanceof Error ? error.message : "無法辨識檔案"}`); }
    finally { if (inputRef.current) inputRef.current.value = ""; }
  }

  function confirmImport() {
    if (!pendingImport) return;
    let imported = pendingImport.dataset;
    if ((imported.cashActivities || []).some((activity) => activity.requiresReview)) {
      const account = imported.accounts.find((item) => item.currency === cashCurrency) || imported.accounts[0];
      imported = classifyCashActivities(imported, { currency: cashCurrency, accountId: account.id });
    }
    setBenchmarkInput(imported.settings?.benchmarkSymbol || "SPY");
    setData(imported);
    setMessage(`已匯入 ${imported.fills.length} 筆成交與 ${(imported.cashActivities || []).length} 筆資金活動。`);
    setPendingImport(null);
  }

  function exportJson() { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `trade-review-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); setMessage("JSON 備份已下載。"); }
  function addFill(event: React.FormEvent) { event.preventDefault(); const fill = { ...form, id: form.id || `fill-${Date.now()}`, symbol: form.symbol.toUpperCase(), timestamp: new Date(form.timestamp).toISOString(), quantity: Number(form.quantity), price: Number(form.price), fee: Number(form.fee) }; setData({ ...data, fills: [...data.fills, fill] }); setDialog(false); setMessage(`已新增 ${fill.symbol} ${fill.side === "BUY" ? "買進" : "賣出"}紀錄。`); }
  function deleteFill(id: string) { setData({ ...data, fills: data.fills.filter((fill) => fill.id !== id) }); setMessage("成交紀錄已刪除。"); }
  function applyBenchmark(event: React.FormEvent) { event.preventDefault(); const symbol = benchmarkInput.trim().toUpperCase(); if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) { setBenchmarkState("請輸入有效的 ETF 代號"); return; } setData({ ...data, settings: { ...(data.settings || { quoteProvider: "json" }), benchmarkSymbol: symbol } }); }

  const metrics = [
    ["總損益（USD等值）", totalUsd == null ? "匯率待更新" : money(totalUsd), moneyByCurrency(totalPnlByCurrency)],
    ["已實現（USD等值）", realizedUsd == null ? "匯率待更新" : money(realizedUsd), moneyByCurrency(report.realizedPnlByCurrency)],
    ["完整閉環", report.cycles.length, `${report.positions.length} 個未平倉部位`],
    ["成交紀錄", data.fills.length, `${(data.cashActivities || []).length} 筆資金活動`],
    ["測試結果", `${tests.filter((test: any) => test.passed).length}/${tests.length}`, tests.every((test: any) => test.passed) ? "目前全部通過" : "需要修正"],
  ];
  const title = tab === "overview" ? "持倉總覽" : tab === "performance" ? "績效分析" : tab === "trades" ? "成交與資金資料" : tab === "cycles" ? "交易閉環" : "測試中心";

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span>TR</span><strong>交易復盤顧問</strong></div>
      <nav aria-label="主要導覽">{[["overview", "持倉總覽"], ["performance", "績效"], ["trades", "成交資料"], ["cycles", "交易閉環"], ["tests", "測試中心"]].map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>
      <div className="provider"><span>行情來源</span><b>市場行情適配器</b><small>持倉與USDTWD每30秒更新；閉環 OHLC 日線自動同步並保存於本機。</small></div>
      <div className="local-note">個人資料只保存在此瀏覽器<br/><b>本機 JSON／CSV 模式</b></div>
    </aside>
    <section className="content">
      <header className="topbar"><div><p className="eyebrow">PHASE 1 · LOCAL FIRST</p><h1>{title}</h1></div><div className="actions"><input ref={inputRef} hidden type="file" accept=".json,.csv,application/json,text/csv" onChange={(event) => prepareImport(event.target.files?.[0])}/><button className="ghost" onClick={() => inputRef.current?.click()}>匯入 JSON／CSV</button><button className="ghost" onClick={exportJson}>匯出備份</button><button className="primary" onClick={() => setDialog(true)}>新增交易</button></div></header>
      <div className="notice"><span>●</span><div><b>{report.issues.some((issue: any) => issue.level === "error") ? "資料需要處理" : "資料計算完成"}</b><p>{message}</p></div></div>
      {tab === "overview" && <>
        <section className="quote-bar"><div><span className="live-dot"/> <b>即時持倉報價</b><small>{quoteState}</small></div><div className="fx-rate"><span>USDTWD</span><b>{fxQuote ? fxQuote.price.toFixed(4) : "—"}</b><small className={fxStale ? "negative" : "positive"}>{fxQuote ? fxStale ? "匯率已過期" : "目前匯率" : "正在取得匯率"}</small></div><div><b>{lastQuoteAt ? new Date(lastQuoteAt).toLocaleTimeString("zh-TW") : "—"}</b><small>{lastQuoteAt ? `${nextRefresh} 秒後更新` : "正在取得報價"}</small></div></section>
        <section className="metrics">{metrics.map(([label, value, hint]) => <article key={String(label)}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>)}</section>
        <section className="asset-grid"><MonthScorecard score={monthScore} monthKey={monthKey}/><article className="panel"><p className="eyebrow">DATA HEALTH</p><h2>資料品質</h2><div className="quality"><strong>{report.qualityPct}%</strong><div><span style={{ width: `${report.qualityPct}%` }}/></div><small>具備持倉期間日線行情的閉環比例</small></div><div className="quality-note"><b>{weeklyEquity.at(-1)?.missingSymbols.length || 0}</b><small>最近週資產估值缺少收盤價的標的</small></div></article></section>
        <article className="panel"><div className="panel-head"><div><p className="eyebrow">OPEN POSITIONS</p><h2>目前持倉</h2></div><span className="muted">{report.positions.length} 個未平倉部位</span></div>{report.positions.length ? report.positions.map((position: any) => { const providerSymbol = toProviderSymbol(position.symbol, position.market); const quote = quotes[providerSymbol]; const direction = position.direction === "SHORT" ? -1 : 1; const unrealized = quote ? (quote.price - position.averageCost) * position.quantity * direction : null; return <div className="position live" key={`${position.accountId}-${position.symbol}`}><div><b>{position.symbol} <span className={`direction ${position.direction.toLowerCase()}`}>{position.direction === "SHORT" ? "空" : "多"}</span></b><small>{position.quantity} 股・均價 {money(position.averageCost, position.currency)}</small></div><div><b>{quote ? money(quote.price, quote.currency) : "更新中"}</b><small className={quote?.changePct != null && quote.changePct >= 0 ? "positive" : "negative"}>{quote?.changePct == null ? "—" : pct(quote.changePct)}</small></div><div><b className={unrealized != null && unrealized >= 0 ? "positive" : "negative"}>{unrealized == null ? "—" : money(unrealized, position.currency)}</b><small>未實現損益</small></div></div>; }) : <Empty text="目前沒有未平倉部位"/>}</article>
        <CycleTable cycles={monthScore.cycles} title={`${monthKey.slice(0, 4)}年${monthKey.slice(5)}月交易閉環`}/>
      </>}
      {tab === "performance" && <PerformancePanel points={weeklyPerformance} monthAssetDelta={monthAssetDelta} monthKey={monthKey} benchmarkSymbol={benchmarkSymbol} benchmarkInput={benchmarkInput} setBenchmarkInput={setBenchmarkInput} benchmarkState={benchmarkState} applyBenchmark={applyBenchmark} fxRate={fxQuote?.price || null}/>}
      {tab === "trades" && <><section className="panel"><div className="panel-head"><div><p className="eyebrow">LEDGER</p><h2>個人成交帳本</h2></div><span className="muted">依成交時間排序</span></div><div className="table-wrap"><table><thead><tr><th>日期</th><th>標的</th><th>方向</th><th>數量</th><th>價格</th><th>費用</th><th></th></tr></thead><tbody>{[...data.fills].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map((fill) => <tr key={fill.id}><td>{fill.timestamp.slice(0, 10)}</td><td><b>{fill.symbol}</b><small className="block">{fill.market}</small></td><td><span className={`side ${fill.side.toLowerCase()}`}>{fill.side === "BUY" ? "買進" : "賣出"}</span></td><td>{fill.quantity}</td><td>{money(fill.price, fill.currency)}</td><td>{money(fill.fee, fill.currency)}</td><td><button className="danger" onClick={() => deleteFill(fill.id)}>刪除</button></td></tr>)}</tbody></table></div></section><CashLedger activities={data.cashActivities || []} accounts={data.accounts}/></>}
      {tab === "cycles" && <CycleTable cycles={report.cycles} title="全部交易閉環" historyState={cycleHistoryState} onRefresh={() => setCycleHistoryRefresh((value) => value + 1)}/>}
      {tab === "tests" && <section className="split tests"><article className="panel"><p className="eyebrow">AUTOMATED TESTS</p><h2>核心計算測試</h2><div className="test-list">{tests.map((test: any) => <div key={test.name}><span className={test.passed ? "pass" : "fail"}>{test.passed ? "✓" : "!"}</span><b>{test.name}</b><small>{test.detail || "通過"}</small></div>)}</div></article><article className="panel"><p className="eyebrow">VALIDATION</p><h2>目前資料檢查</h2>{report.issues.length ? <div className="test-list">{report.issues.map((issue: any, index: number) => <div key={`${issue.code}-${index}`}><span className={issue.level === "error" ? "fail" : "warn-dot"}>!</span><b>{issue.code}</b><small>{issue.message}</small></div>)}</div> : <Empty text="沒有發現資料問題"/>}</article></section>}
    </section>
    {pendingImport && <div className="overlay" role="dialog" aria-modal="true" aria-label="匯入資料確認"><div className="modal import-modal"><div className="panel-head"><div><p className="eyebrow">IMPORT REVIEW</p><h2>確認匯入資料</h2></div><button type="button" className="close" onClick={() => setPendingImport(null)}>×</button></div><p className="modal-copy">檔案會在本機瀏覽器中取代目前帳本，確認前不會修改資料。</p><div className="import-summary"><article><span>格式</span><b>{pendingImport.kind}</b><small>{pendingImport.fileName}</small></article><article><span>成交</span><b>{pendingImport.dataset.fills.length}</b><small>{pendingImport.duplicateCount} 筆與目前ID相同</small></article><article><span>資金活動</span><b>{(pendingImport.dataset.cashActivities || []).length}</b><small>{(pendingImport.dataset.cashActivities || []).filter((activity) => activity.requiresReview).length} 筆待指定幣別</small></article><article><span>行情日線</span><b>{pendingImport.dataset.marketBars.length}</b><small>CSV會保留可匹配的既有日線</small></article></div>{(pendingImport.dataset.cashActivities || []).some((activity) => activity.requiresReview) && <label className="cash-choice">待確認資金活動幣別<select value={cashCurrency} onChange={(event) => setCashCurrency(event.target.value)}><option value="USD">USD 美元</option><option value="TWD">TWD 台幣</option></select></label>}{pendingImport.warnings.length > 0 && <div className="import-warnings"><b>資料提醒</b>{pendingImport.warnings.map((warning, index) => <p key={index}>• {warning}</p>)}</div>}<div className="modal-actions"><button type="button" className="ghost" onClick={() => setPendingImport(null)}>取消</button><button type="button" className="primary" onClick={confirmImport}>確認匯入並取代</button></div></div></div>}
    {dialog && <div className="overlay" role="dialog" aria-modal="true"><form className="modal" onSubmit={addFill}><div className="panel-head"><div><p className="eyebrow">NEW FILL</p><h2>新增成交</h2></div><button type="button" className="close" onClick={() => setDialog(false)}>×</button></div><div className="form-grid"><label>股票代號<input required value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value })}/></label><label>方向<select value={form.side} onChange={(event) => setForm({ ...form, side: event.target.value as "BUY" | "SELL" })}><option value="BUY">買進</option><option value="SELL">賣出</option></select></label><label>數量<input required min="0.0001" step="any" type="number" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })}/></label><label>成交價<input required min="0.0001" step="any" type="number" value={form.price} onChange={(event) => setForm({ ...form, price: Number(event.target.value) })}/></label><label>手續費<input min="0" step="any" type="number" value={form.fee} onChange={(event) => setForm({ ...form, fee: Number(event.target.value) })}/></label><label>成交時間<input required type="datetime-local" value={form.timestamp} onChange={(event) => setForm({ ...form, timestamp: event.target.value })}/></label><label className="wide">備註<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })}/></label></div><div className="modal-actions"><button type="button" className="ghost" onClick={() => setDialog(false)}>取消</button><button className="primary">儲存成交</button></div></form></div>}
  </main>;
}

type PerformancePoint = { weekStart: string; asOf: string; totalUsd: number | null; portfolioPct: number | null; benchmarkPct: number | null };
type MonthScore = { cycles: any[]; averageReturn: number | null; averageWinningReturn: number | null; winners: number; losers: number; flat: number; winRate: number | null };

function MonthScorecard({ score, monthKey }: { score: MonthScore; monthKey: string }) {
  return <article className="panel score-panel"><div className="panel-head"><div><p className="eyebrow">MONTHLY SCORECARD</p><h2>{monthKey.slice(5)}月交易計分表</h2></div><span className="muted">依出場日歸屬月份</span></div><div className="score-grid"><div><span>當月平均報酬率</span><b className={score.averageReturn != null && score.averageReturn >= 0 ? "positive" : "negative"}>{pct(score.averageReturn)}</b><small>包含全部當月閉環</small></div><div><span>平均交易獲利率</span><b className="positive">{pct(score.averageWinningReturn)}</b><small>只計損益為正的閉環</small></div><div><span>獲利：虧損</span><b>{score.winners}：{score.losers}</b><small>{score.flat ? `${score.flat} 筆損益兩平` : "不含損益兩平"}</small></div><div><span>獲利交易率</span><b>{score.winRate == null ? "—" : `${(score.winRate * 100).toFixed(1)}%`}</b><small>{score.cycles.length} 筆當月閉環</small></div></div></article>;
}

function PerformancePanel({ points, monthAssetDelta, monthKey, benchmarkSymbol, benchmarkInput, setBenchmarkInput, benchmarkState, applyBenchmark, fxRate }: { points: PerformancePoint[]; monthAssetDelta: number | null; monthKey: string; benchmarkSymbol: string; benchmarkInput: string; setBenchmarkInput: (value: string) => void; benchmarkState: string; applyBenchmark: (event: React.FormEvent) => void; fxRate: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visiblePoints = useMemo(() => points.filter((point) => point.portfolioPct != null || point.benchmarkPct != null), [points]);
  const latest = [...points].reverse().find((point) => point.totalUsd != null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || visiblePoints.length === 0) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(320, rect.width);
      const height = Math.max(240, rect.height);
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale);
      context.clearRect(0, 0, width, height);
      const values = visiblePoints.flatMap((point) => [point.portfolioPct, point.benchmarkPct]).filter((value): value is number => value != null && Number.isFinite(value));
      const maxAbs = Math.max(...values.map(Math.abs), 0.01);
      const padding = { top: 24, right: 18, bottom: 28, left: 18 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const zeroY = padding.top + chartHeight / 2;
      context.strokeStyle = "#dfe3da";
      context.lineWidth = 1;
      [0, 0.25, 0.75, 1].forEach((ratio) => { const y = padding.top + ratio * chartHeight; context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke(); });
      context.strokeStyle = "#7a8581";
      context.lineWidth = 1.5;
      context.beginPath(); context.moveTo(padding.left, zeroY); context.lineTo(width - padding.right, zeroY); context.stroke();
      context.fillStyle = "#66716e";
      context.font = "11px Arial";
      context.fillText("0%", padding.left, zeroY - 6);
      const groupWidth = chartWidth / visiblePoints.length;
      const barWidth = Math.max(5, Math.min(22, groupWidth * 0.25));
      visiblePoints.forEach((point, index) => {
        const centerX = padding.left + groupWidth * (index + 0.5);
        [[point.portfolioPct, "#176b50", -barWidth - 2], [point.benchmarkPct, "#d68b32", 2]].forEach(([rawValue, color, offset]) => {
          if (rawValue == null) return;
          const value = Number(rawValue);
          const barHeight = Math.abs(value) / maxAbs * (chartHeight / 2 - 8);
          context.fillStyle = String(color);
          context.fillRect(centerX + Number(offset), value >= 0 ? zeroY - barHeight : zeroY, barWidth, Math.max(barHeight, 1));
        });
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [visiblePoints]);

  return <><section className="performance-summary"><article><span>{monthKey.slice(5)}月資產變化累計差額</span><b className={monthAssetDelta != null && monthAssetDelta >= 0 ? "positive" : "negative"}>{monthAssetDelta == null ? "—" : money(monthAssetDelta)}</b><small>月初前最後有效週資產至目前</small></article><article><span>目前總資產</span><b>{latest?.totalUsd == null ? "—" : money(Number(latest.totalUsd))}</b><small>{latest ? `截至 ${latest.asOf}` : "等待資產資料"}</small></article><article><span>比較基準</span><b>{benchmarkSymbol}</b><small>{benchmarkState}</small></article></section><article className="panel performance-panel"><div className="panel-head performance-head"><div><p className="eyebrow">WEEK OVER WEEK</p><h2>每週績效比較</h2></div><form className="benchmark-form" onSubmit={applyBenchmark}><label htmlFor="benchmark">ETF 比較基準</label><input id="benchmark" aria-label="ETF 比較基準" value={benchmarkInput} onChange={(event) => setBenchmarkInput(event.target.value.toUpperCase())} placeholder="例如 SPY"/><button className="primary">套用</button></form></div><div className="chart-legend"><span><i className="portfolio-color"/>我的資產</span><span><i className="benchmark-color"/>{benchmarkSymbol}</span><small>每週相較上週；中央線為 0%</small></div>{visiblePoints.length ? <><canvas ref={canvasRef} className="performance-canvas" role="img" aria-label={`每週資產績效與 ${benchmarkSymbol} 比較，中央為零軸`}>每週績效比較圖</canvas><div className="table-wrap performance-table"><table><thead><tr><th>週起始日</th><th>我的資產</th><th>{benchmarkSymbol}</th><th>週末總資產</th></tr></thead><tbody>{visiblePoints.map((point) => <tr key={point.weekStart}><td>{point.weekStart}</td><td className={point.portfolioPct != null && point.portfolioPct >= 0 ? "positive" : "negative"}>{pct(point.portfolioPct)}</td><td className={point.benchmarkPct != null && point.benchmarkPct >= 0 ? "benchmark-positive" : "negative"}>{pct(point.benchmarkPct)}</td><td>{point.totalUsd == null ? "—" : money(Number(point.totalUsd))}</td></tr>)}</tbody></table></div><div className="chart-foot"><small>投資組合以各週最後可用收盤價估值；TWD 依目前 USDTWD {fxRate ? fxRate.toFixed(4) : "待更新"} 換算。ETF 使用還原收盤價，資料無法取得時仍保留投資組合績效。</small></div></> : <Empty text="至少需要連續兩週有效資產資料，才能計算週績效"/>}</article></>;
}

function CashLedger({ activities, accounts }: { activities: CashActivity[]; accounts: Dataset["accounts"] }) { const accountNames = Object.fromEntries(accounts.map((account) => [account.id, account.name])); return <section className="panel"><div className="panel-head"><div><p className="eyebrow">CASH ACTIVITIES</p><h2>資金活動帳本</h2></div><span className="muted">不計入交易損益</span></div>{activities.length ? <div className="table-wrap"><table><thead><tr><th>日期</th><th>類型</th><th>帳戶</th><th>金額</th><th>狀態</th><th>來源</th></tr></thead><tbody>{[...activities].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map((activity) => <tr key={activity.id}><td>{activity.timestamp.slice(0, 10)}</td><td>{activity.type === "DEPOSIT" ? "入金" : activity.type}</td><td>{activity.accountId ? accountNames[activity.accountId] || activity.accountId : "待指定"}</td><td>{activity.currency ? money(activity.amount, activity.currency) : activity.amount.toLocaleString("zh-TW")}</td><td><span className={activity.requiresReview ? "status warn" : "status ok"}>{activity.requiresReview ? "待確認" : "已確認"}</span></td><td>{activity.source || "本機資料"}</td></tr>)}</tbody></table></div> : <Empty text="尚無入金、出金或其他資金活動"/>}</section>; }
function CycleTable({ cycles, title, historyState, onRefresh }: { cycles: any[]; title: string; historyState?: string; onRefresh?: () => void }) { return <section className="panel"><div className="panel-head"><div><p className="eyebrow">CLOSED CYCLES</p><h2>{title}</h2></div>{onRefresh ? <div className="cycle-actions"><span className="muted">{historyState}</span><button className="ghost" type="button" onClick={onRefresh}>更新閉環行情</button></div> : <span className="muted">FIFO・多空雙向・日曆日</span>}</div>{cycles.length ? <div className="table-wrap"><table><thead><tr><th>標的</th><th>方向</th><th>期間</th><th>進場價</th><th>出場價</th><th>持倉</th><th>損益</th><th>報酬</th><th>MAE</th><th>MFE</th><th>行情</th></tr></thead><tbody>{cycles.map((cycle) => <tr key={cycle.id}><td><b>{cycle.symbol}</b></td><td><span className={`direction ${cycle.direction.toLowerCase()}`}>{cycle.direction === "SHORT" ? "空" : "多"}</span></td><td>{cycle.openAt.slice(0, 10)} → {cycle.closeAt.slice(0, 10)}</td><td>{money(cycle.averageEntry, cycle.currency)}</td><td>{money(cycle.averageExit, cycle.currency)}</td><td>{cycle.holdingDays} 天</td><td className={cycle.pnl >= 0 ? "positive" : "negative"}>{money(cycle.pnl, cycle.currency)}</td><td>{pct(cycle.returnPct)}</td><td>{pct(cycle.maePct)}</td><td>{pct(cycle.mfePct)}</td><td><span className={cycle.quality === "完整" ? "status ok" : "status warn"}>{cycle.quality}</span></td></tr>)}</tbody></table></div> : <Empty text="尚未形成完整交易閉環"/>}</section>; }
function Empty({ text }: { text: string }) { return <div className="empty"><span>○</span><p>{text}</p></div>; }
