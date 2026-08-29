/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { TradeEntryWorkspace, EntryContextEvidence } from "./trade-entry-workspace";
import { createEntryDraft, commitEntry } from "@/lib/trade-entry.mjs";
import { Fragment, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runSelfTests, STORAGE_KEY, summarize } from "@/lib/trade-engine.mjs";
import { isQuoteStale, mergeMarketBars, pnlToUsd, QUOTE_REFRESH_MS, toProviderSymbol, USDTWD_SYMBOL } from "@/lib/quote-engine.mjs";
import { classifyCashActivities, importTradingViewCsv, preserveExistingCashOnFillImport } from "@/lib/trader-x2-importer.mjs";
import { buildCurrentEquity, buildPositionMetrics, buildWeeklyEquitySeries, buildWeeklyPerformance, monthlyAssetChange, cycleRangeScore, positionPortfolioImpactPct } from "@/lib/portfolio-engine.mjs";
import { analyzeCycle, findRapidRepurchases, weeklyCycleStats } from "@/lib/review-engine.mjs";
import { completeTradeJson, DEFAULT_RECORD_ACCOUNT_ID, durableTradeJson, makeRecordAccountId, RECORD_ACCOUNT_KEY, selectStartupAccount } from "@/lib/trade-record-store.mjs";
import { buildTradeSnapshot, mergeSnapshotEvidence, restoreMarketSnapshot } from "@/lib/trade-snapshot.mjs";
import { browserRecordStorage, createRecordSaveQueue, readPendingRecord, saveTradeRecord, writeLocalRecord } from "@/lib/trade-record-client.mjs";
import { serializeInBackground } from "@/lib/background-serializer.mjs";
import { openPositionWindowDates, replayWindowDates } from "@/lib/coach-engine.mjs";
import { createStrategyAssignment, normalizeStrategyDataset, updateStrategyCheck } from "@/lib/strategy-engine.mjs";
import { ReplayBoard, TrainingWorkspace } from "./training-workspace";
import { StrategyChecklist, StrategyWorkspace } from "./strategy-workspace";
import { QualityTagPicker } from "./quality-rating-control";
import { updateQualityRating } from "@/lib/quality-rating.mjs";
import { DialogFrame, OverviewDisclosure, SectionLinks } from "./workspace-ui";
import { PositionTransactions } from "./position-transactions";
import { EquityBreakdown } from "./equity-breakdown";
import { MonthlyAssets } from "./monthly-assets";

type Fill = { id: string; accountId: string; symbol: string; market: string; currency: string; side: "BUY" | "SELL"; quantity: number; price: number; fee: number; timestamp: string; note?: string };
type CashActivity = { id: string; type: string; amount: number; timestamp: string; accountId: string | null; currency: string | null; requiresReview?: boolean; source?: string; note?: string };
type PositionPlan = { source?: string; takeProfit?: number | null; stopLoss?: number | null; note?: string; updatedAt?: string };
type PositionPlanField = "takeProfit" | "stopLoss" | "note";
type CycleReview = { preTradePlan?: string; invalidation?: string; entryReview?: string; exitReason?: string; exitReview?: string; reflection?: string; tags?: string; plannedStop?: number | null; revisedStop?: number | null; entryQualityTag?: "EARLY" | "LATE" | "IDEAL" | "WRONG_ENTRY" | null; exitQualityTag?: "EARLY" | "LATE" | "IDEAL" | null; qualityRatedAt?: string; updatedAt?: string };
type CycleReviewField = "preTradePlan" | "invalidation" | "entryReview" | "exitReason" | "exitReview" | "reflection" | "tags" | "plannedStop" | "revisedStop" | "entryQualityTag" | "exitQualityTag";
type DecisionLink = { linked: boolean; updatedAt: string };
type DecisionLinkEvent = { pairKey: string; linked: boolean; updatedAt: string };
type PlanVersion = { id: string; cycleId?: string; accountId: string; symbol: string; field: "stopLoss" | "takeProfit" | "invalidation"; value: number | string | null; reason?: string; effectiveAt?: string | null; createdAt: string; source?: string };
type ImprovementExperiment = { id: string; findingType: string; title: string; trigger: string; action: string; metric: string; target: string; startDate: string; endDate: string; status: "ACTIVE" | "COMPLETED"; baseline?: { sampleCount: number; violationCount: number; impactUsd: number }; evidenceCycleIds?: string[]; createdAt: string; updatedAt?: string; resultNote?: string };
type Dataset = { entryDraft?: any; entryContexts?: Record<string, any>; marketSnapshot?: any; version: string; profile: { name: string; baseCurrency: string; costMethod: string }; accounts: { id: string; name: string; currency: string }[]; fills: Fill[]; cashActivities?: CashActivity[]; marketBars: Record<string, unknown>[]; settings: { quoteProvider: string; benchmarkSymbol?: string }; positionPlans?: Record<string, PositionPlan>; cycleReviews?: Record<string, CycleReview>; decisionLinks?: Record<string, DecisionLink>; decisionLinkHistory?: DecisionLinkEvent[]; planHistory?: PlanVersion[]; improvementExperiments?: ImprovementExperiment[]; strategies?: any[]; strategyAssignments?: Record<string, any>; source?: { fileName?: string; format?: string } };
type Quote = { symbol: string; price: number; previousClose: number | null; changePct: number | null; currency: string; marketState: string; updatedAt: string; source: string };
type HistoryBar = { symbol: string; date: string; close: number; open?: number; high?: number; low?: number; volume?: number | null };
type PendingImport = { dataset: Dataset; fileName: string; kind: "JSON" | "TradingView CSV"; duplicateCount: number; warnings: string[] };
type RecordAccount = { id: string; name: string; version: number; updatedAt: string };

const emptyData: Dataset = { version: "0.1.0", profile: { name: "我的交易帳本", baseCurrency: "USD", costMethod: "FIFO" }, accounts: [{ id: "main", name: "主要帳戶", currency: "USD" }], fills: [], cashActivities: [], marketBars: [], settings: { quoteProvider: "json", benchmarkSymbol: "SPY" }, positionPlans: {}, cycleReviews: {}, decisionLinks: {}, decisionLinkHistory: [], planHistory: [], improvementExperiments: [], strategies: [], strategyAssignments: {} };
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
function money(value: number, currency = "USD") { return new Intl.NumberFormat("zh-TW", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2 }).format(value); }
function moneyByCurrency(values: Record<string, number>) { const rows = Object.entries(values).filter(([, value]) => Math.abs(value) > 1e-9); return rows.length ? rows.map(([currency, value]) => money(value, currency)).join(" · ") : money(0); }
function usdOrDash(value: number | null) { return value == null ? "—" : money(value, "USD"); }
function localDateTime(value?: string) { return value ? new Date(value).toLocaleString("zh-TW", { hour12: false }) : "尚未設定"; }
function addCurrencyValues(...groups: Record<string, number>[]) { return groups.reduce<Record<string, number>>((result, group) => { Object.entries(group).forEach(([currency, value]) => { result[currency] = (result[currency] || 0) + value; }); return result; }, {}); }
function currentMonthKey(now = new Date()) { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).formatToParts(now); return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`; }
function cycleHistoryTargets(cycles: any[], positions: any[]) {
  const grouped = new Map<string, { symbol: string; market: string; start: string; end: string }>();
  for (const item of [...cycles.map((cycle) => ({ item: cycle, range: replayWindowDates(cycle) })), ...positions.map((position) => ({ item: position, range: openPositionWindowDates(position) }))]) {
    const key = `${item.item.market || ""}:${item.item.symbol}`;
    const { start, end } = item.range;
    const current = grouped.get(key);
    grouped.set(key, { symbol: item.item.symbol, market: item.item.market || "", start: current && current.start < start ? current.start : start, end: current && current.end > end ? current.end : end });
  }
  return [...grouped.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}
function legacyPositionPlanKey(position: { accountId: string; symbol: string }) { return `${position.accountId}:${position.symbol}`; }
function positionPlanKey(position: { id?: string; accountId: string; symbol: string }) { return position.id || legacyPositionPlanKey(position); }
function positionPlanFor(plans: Record<string, PositionPlan>, position: { id?: string; accountId: string; symbol: string }) { return plans[positionPlanKey(position)] || plans[legacyPositionPlanKey(position)] || {}; }
function linkedCycleReviews(cycles: any[], plans: Record<string, PositionPlan>, reviews: Record<string, CycleReview>) {
  return Object.fromEntries(cycles.map((cycle) => {
    const plan = plans[cycle.id] || plans[legacyPositionPlanKey(cycle)] || {};
    const review = reviews[cycle.id] || {};
    return [cycle.id, { ...review, plannedStop: review.plannedStop ?? (plan.source === "POST_TRADE_ENTRY" ? null : plan.stopLoss) ?? null, takeProfit: (review as any).takeProfit ?? plan.takeProfit ?? null, invalidation: review.invalidation || plan.note || "", preTradePlan: review.preTradePlan || plan.note || "" }];
  }));
}
function durableDatasetJson(dataset: Dataset) { return durableTradeJson(dataset); }

let historyFetchQueue: Promise<void> = Promise.resolve();
function fetchHistoryInBackground(url: string, signal: AbortSignal) {
  const run = async () => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(url, { signal });
      const payload = await response.json();
      if (response.ok) return payload;
      const message = payload.error || `HTTP ${response.status}`;
      if (attempt === 0 && (response.status === 429 || String(message).includes("429"))) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        continue;
      }
      throw new Error(message);
    }
  };
  const task = historyFetchQueue.then(run, run);
  historyFetchQueue = task.then(() => undefined, () => undefined);
  return task;
}

export default function TradeWorkspace() {
  const [data, setData] = useState<Dataset>(demoData);
  const [storageReady, setStorageReady] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [recordAccounts, setRecordAccounts] = useState<RecordAccount[]>([]);
  const [activeRecordAccountId, setActiveRecordAccountId] = useState(DEFAULT_RECORD_ACCOUNT_ID);
  const [saveState, setSaveState] = useState("正在載入交易帳號…");
  const [tab, setTab] = useState("overview");
  const [navOpen, setNavOpen] = useState(false);
  const [ledgerTab, setLedgerTab] = useState("fills");
  const changePage = (nextTab: string) => { setTab(nextTab); setNavOpen(false); document.getElementById("workspace-main")?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "instant" }); };
  const [message, setMessage] = useState("資料已從本機或示範檔載入；可匯入 JSON 或 TradingView CSV 覆蓋。");
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [cashCurrency, setCashCurrency] = useState("USD");
  const benchmarkSymbol = data.settings?.benchmarkSymbol || "SPY";
  const [benchmarkInput, setBenchmarkInput] = useState(benchmarkSymbol);
  const [benchmarkBars, setBenchmarkBars] = useState<HistoryBar[]>([]);
  const [benchmarkDataSymbol, setBenchmarkDataSymbol] = useState(benchmarkSymbol);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [quoteState, setQuoteState] = useState("準備更新");
  const [lastQuoteAt, setLastQuoteAt] = useState<number | null>(null);
  const [manualSaving, setManualSaving] = useState(false);
  const manualSavingRef = useRef(false);
  const [benchmarkState, setBenchmarkState] = useState("準備讀取 ETF 歷史行情");
  const [cycleHistoryState, setCycleHistoryState] = useState("準備同步閉環日線");
  const [cycleHistoryRefresh, setCycleHistoryRefresh] = useState(0);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [positionEventId, setPositionEventId] = useState<string | undefined>();
  const openPositionChart = useCallback((position: { id: string }, eventId?: string) => {
    setPositionEventId(eventId);
    setSelectedPositionId(position.id);
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const planCommitPendingRef = useRef(new Set<string>());
  const recordVersionRef = useRef<number | null>(null);
  const lastSavedJsonRef = useRef("");
  const saveQueueRef = useRef(createRecordSaveQueue());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryCountRef = useRef(0);
  const [saveRetry, setSaveRetry] = useState(0);
  const [storageConflict, setStorageConflict] = useState(false);
  const activeRecordAccountName = recordAccounts.find((account) => account.id === activeRecordAccountId)?.name || data.profile.name || "主要交易帳號";
  const durableJson = useMemo(() => durableDatasetJson(data), [data]);
  const completeSnapshot = useMemo(() => buildTradeSnapshot(data, { quotes, lastQuoteAt, benchmarkBars, benchmarkSymbol: benchmarkDataSymbol }) as Dataset, [data, quotes, lastQuoteAt, benchmarkBars, benchmarkDataSymbol]);
  const latestSaveRef = useRef({ accountId: activeRecordAccountId, serialized: durableJson, dataset: completeSnapshot });
  const lastSavedSnapshotRef = useRef<Dataset | null>(null);
  useEffect(() => { latestSaveRef.current = { accountId: activeRecordAccountId, serialized: durableJson, dataset: completeSnapshot }; }, [activeRecordAccountId, durableJson, completeSnapshot]);
  const loadDataset = useCallback((incoming: Dataset) => {
    const restored = restoreMarketSnapshot(incoming);
    setData(normalizeStrategyDataset(incoming) as Dataset);
    setQuotes(restored.quotes);
    setLastQuoteAt(restored.lastQuoteAt);
    setBenchmarkInput(restored.benchmarkSymbol);
    setBenchmarkDataSymbol(restored.benchmarkSymbol);
    setBenchmarkBars(restored.benchmarkBars);
    setQuoteState(Object.keys(restored.quotes).length ? "已還原儲存行情，正在背景更新" : "備份沒有報價快照，正在取得行情");
  }, []);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      let preferredId = DEFAULT_RECORD_ACCOUNT_ID;
      let localData = demoData;
      try {
        preferredId = localStorage.getItem(RECORD_ACCOUNT_KEY) || DEFAULT_RECORD_ACCOUNT_ID;
        const localText = localStorage.getItem(`${STORAGE_KEY}.${preferredId}`) || (preferredId === DEFAULT_RECORD_ACCOUNT_ID ? localStorage.getItem(STORAGE_KEY) : null);
        if (localText) localData = JSON.parse(localText);
      } catch (error) { console.warn("無法恢復本機交易資料", error); }
      try {
        const listResponse = await fetch("/api/trade-records", { cache: "no-store" });
        if (!listResponse.ok) throw new Error(`HTTP ${listResponse.status}`);
        const listPayload = await listResponse.json();
        const selected = selectStartupAccount(listPayload.accounts || [], preferredId) as RecordAccount | null;
        if (!selected) {
          const seedResponse = await fetch("/api/trade-records", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: preferredId, accountName: localData.profile.name || "主要交易帳號", dataset: localData }) });
          const seedPayload = await seedResponse.json();
          if (!seedResponse.ok) throw new Error(seedPayload.error || `HTTP ${seedResponse.status}`);
          if (!active) return;
          const account = seedPayload.account as RecordAccount;
          loadDataset(localData);
          setRecordAccounts([account]);
          setActiveRecordAccountId(account.id);
          recordVersionRef.current = account.version;
          lastSavedJsonRef.current = completeTradeJson(localData);
          try { localStorage.setItem(RECORD_ACCOUNT_KEY, account.id); } catch { /* Preferences must not block account loading. */ }
          setSaveState("紀錄已建立至帳號資料庫");
        } else {
          const recordResponse = await fetch(`/api/trade-records?accountId=${encodeURIComponent(selected.id)}`, { cache: "no-store" });
          const recordPayload = await recordResponse.json();
          if (!recordResponse.ok) throw new Error(recordPayload.error || `HTTP ${recordResponse.status}`);
          if (!active) return;
          const recovery = readPendingRecord(browserRecordStorage(), STORAGE_KEY, selected.id, recordPayload.dataset);
          loadDataset(recovery.dataset);
          setStorageConflict(Boolean(recovery.conflict));
          setRecordAccounts(listPayload.accounts);
          setActiveRecordAccountId(selected.id);
          recordVersionRef.current = recordPayload.account.version;
          lastSavedJsonRef.current = recovery.conflict ? recovery.baselineJson : completeTradeJson(recordPayload.dataset);
          try { localStorage.setItem(RECORD_ACCOUNT_KEY, selected.id); } catch { /* Preferences must not block account loading. */ }
          setSaveState(recovery.conflict ? "本機未同步紀錄與資料庫不同；已保留本機內容，請先匯出備份再確認版本" : recovery.recovered ? "已恢復未完成的儲存，正在重新同步…" : `已載入最新紀錄・${localDateTime(recordPayload.account.updatedAt)}`);
          if (recovery.legacyRecoveryKey || recovery.recoveryWarning) setMessage("發現舊版未同步暫存，未自動覆蓋資料庫；請保留已下載的最新 JSON，確認後重新匯入。");
        }
        setCloudReady(true);
      } catch (error) {
        if (!active) return;
        loadDataset(localData);
        setActiveRecordAccountId(preferredId);
        lastSavedJsonRef.current = completeTradeJson(localData);
        setCloudReady(true);
        setSaveState(`帳號資料庫暫時無法使用，已載入瀏覽器暫存：${error instanceof Error ? error.message : "未知錯誤"}`);
      } finally {
        if (active) setStorageReady(true);
      }
    };
    restore();
    return () => { active = false; };
  }, [loadDataset]);

  const persistCompleteSnapshot = useCallback((force = false, label = "自動") => saveQueueRef.current(async () => {
    if (storageConflict) throw Object.assign(new Error("尚有版本衝突，請先匯出備份並確認版本"), { status: 409, retryable: false });
    const captured = latestSaveRef.current;
    if (captured.accountId !== activeRecordAccountId) return;
    const serialized = await serializeInBackground(captured.dataset);
    if (latestSaveRef.current.accountId !== captured.accountId) return;
    const localSaved = writeLocalRecord(browserRecordStorage(), STORAGE_KEY, captured.accountId, captured.serialized, lastSavedJsonRef.current, recordVersionRef.current);
    if (!force && serialized === lastSavedJsonRef.current && recordVersionRef.current != null) {
      lastSavedSnapshotRef.current = captured.dataset;
      return;
    }
    setSaveState(`正在${label}儲存完整資料…`);
    const saved = await saveTradeRecord({ accountId: captured.accountId, accountName: activeRecordAccountName, serialized, baseVersion: recordVersionRef.current, baselineJson: lastSavedJsonRef.current, saveMode: force ? "manual" : "auto" });
    if (latestSaveRef.current.accountId !== captured.accountId) return;
    if (saved.dataset && durableDatasetJson(saved.dataset) !== captured.serialized && latestSaveRef.current.serialized !== captured.serialized) {
      throw Object.assign(new Error("同步期間又有本機修改；已停止覆寫，請先匯出備份再確認版本"), { status: 409, retryable: false });
    }
    recordVersionRef.current = saved.account.version;
    lastSavedJsonRef.current = saved.serialized;
    lastSavedSnapshotRef.current = captured.dataset;
    retryCountRef.current = 0;
    clearTimeout(retryTimerRef.current);
    let pending = latestSaveRef.current;
    if (saved.dataset && saved.serialized !== serialized) {
      const preferred = pending.serialized === captured.serialized ? saved.dataset : pending.dataset;
      const merged = mergeSnapshotEvidence(preferred, pending.serialized === captured.serialized ? pending.dataset : saved.dataset);
      loadDataset(merged as Dataset);
      pending = { ...pending, dataset: merged as Dataset, serialized: durableDatasetJson(merged) };
      latestSaveRef.current = pending;
    }
    writeLocalRecord(browserRecordStorage(), STORAGE_KEY, captured.accountId, pending.serialized, saved.serialized, saved.account.version);
    setRecordAccounts(current => [saved.account, ...current.filter(account => account.id !== saved.account.id)]);
    const newerEdits = pending.dataset !== captured.dataset && !saved.dataset;
    setSaveState(`${label}儲存完成・${new Date(saved.account.updatedAt).toLocaleTimeString("zh-TW", { hour12: false })}・v${saved.account.version}${newerEdits ? "；較新資料待背景儲存" : ""}${localSaved ? "" : "；瀏覽器暫存不可用（完整資料已寫入）"}`);
    return saved;
  }), [activeRecordAccountId, activeRecordAccountName, loadDataset, storageConflict]);

  const handleSaveError = useCallback((error: any) => {
    const retryable = error?.retryable !== false;
    if (error?.status === 409) setStorageConflict(true);
    const delay = Math.min(30_000, 5_000 * 2 ** retryCountRef.current++);
    setSaveState(`儲存尚未完成：${error instanceof Error ? error.message : "未知錯誤"}${retryable ? `；${delay / 1000} 秒後重試` : ""}`);
    clearTimeout(retryTimerRef.current);
    if (retryable) retryTimerRef.current = setTimeout(() => setSaveRetry(current => current + 1), delay);
  }, []);

  async function manualSave() {
    if (!storageReady || !cloudReady || storageConflict || manualSavingRef.current) return;
    manualSavingRef.current = true;
    setManualSaving(true);
    try {
      const saved = await persistCompleteSnapshot(true, "手動");
      if (saved) {
        const snapshot = saved.dataset || JSON.parse(saved.serialized);
        const market = restoreMarketSnapshot(snapshot);
        const missing = [
          snapshot.fills.length && !snapshot.marketBars.length ? "日線" : "",
          summarize(snapshot).positions.some((position: any) => !market.quotes[toProviderSymbol(position.symbol, position.market)]) ? "部分持倉報價" : "",
          snapshot.accounts.some((account: any) => account.currency === "TWD") && !market.quotes[USDTWD_SYMBOL] ? "匯率" : "",
          !market.benchmarkBars.length ? "基準 ETF 行情" : "",
        ].filter(Boolean);
        setMessage(missing.length ? `已保存所有已載入資料；尚未取得${missing.join("、")}，取得後會自動補存。` : "完整快照已寫入，包含交易、計畫、策略、評分、資金及已載入行情。重新開啟時先還原快照，再背景更新。");
      }
    }
    catch (error) { handleSaveError(error); }
    finally { manualSavingRef.current = false; setManualSaving(false); }
  }

  useEffect(() => {
    if (!storageReady || !cloudReady || storageConflict) return;
    const timer = window.setTimeout(() => { void persistCompleteSnapshot().catch(handleSaveError); }, 900);
    return () => window.clearTimeout(timer);
  }, [cloudReady, completeSnapshot, saveRetry, storageConflict, storageReady, persistCompleteSnapshot, handleSaveError]);
  useEffect(() => () => clearTimeout(retryTimerRef.current), []);

  useEffect(() => {
    const retry = () => setSaveRetry(current => current + 1);
    const preserve = () => {
      if (!storageReady) return;
      const latest = latestSaveRef.current;
      writeLocalRecord(browserRecordStorage(), STORAGE_KEY, latest.accountId, latest.serialized, lastSavedJsonRef.current, recordVersionRef.current);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      preserve();
      if (storageReady && latestSaveRef.current.dataset !== lastSavedSnapshotRef.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("online", retry);
    window.addEventListener("pagehide", preserve);
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("online", retry); window.removeEventListener("pagehide", preserve); window.removeEventListener("beforeunload", beforeUnload); };
  }, [storageReady]);
  const calculationData = useMemo(() => ({ fills: data.fills, marketBars: data.marketBars }), [data.fills, data.marketBars]);
  const report = useMemo(() => summarize(calculationData), [calculationData]);
  const tests = useMemo(() => runSelfTests(), []);
  const quoteTargets = useMemo(() => [...new Set([...report.positions.map((position: any) => toProviderSymbol(position.symbol, position.market)), USDTWD_SYMBOL])], [report.positions]);
  const quoteKey = quoteTargets.join(",");
  const cycleHistoryKey = JSON.stringify(cycleHistoryTargets(report.cycles, report.positions));

  useEffect(() => {
    if (!storageReady) return;
    let active = true;
    let inFlight = false;
    let controller: AbortController | null = null;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(quoteKey)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!active) return;
        startTransition(() => {
          setQuotes((current) => ({
            ...current,
            ...Object.fromEntries(payload.quotes.map((quote: Quote) => [quote.symbol, quote])),
          }));
          if (payload.quotes.length) setLastQuoteAt(Date.now());
          setQuoteState(payload.errors?.length ? `${payload.errors.length} 個報價更新失敗` : "背景行情已更新");
        });
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) startTransition(() => setQuoteState(`更新失敗：${error instanceof Error ? error.message : "未知錯誤"}`));
      } finally { inFlight = false; }
    };
    refresh();
    const timer = window.setInterval(refresh, QUOTE_REFRESH_MS);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); };
  }, [quoteKey, storageReady, activeRecordAccountId]);

  useEffect(() => {
    if (!storageReady) return;
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      setBenchmarkState(`正在讀取 ${benchmarkSymbol}…`);
      try {
        const payload = await fetchHistoryInBackground(`/api/history?symbol=${encodeURIComponent(benchmarkSymbol)}`, controller.signal);
        if (!active) return;
        startTransition(() => {
          setBenchmarkBars(payload.bars || []);
          setBenchmarkDataSymbol(benchmarkSymbol);
          setBenchmarkState(`${benchmarkSymbol} 背景更新完成・${payload.bars?.length || 0} 個交易日`);
        });
      } catch (error) {
        if (!active) return;
        if (!(error instanceof DOMException && error.name === "AbortError")) startTransition(() => {
          setBenchmarkState(`ETF 行情失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
        });
      }
    };
    load();
    return () => { active = false; controller.abort(); };
  }, [benchmarkSymbol, storageReady, activeRecordAccountId]);

  useEffect(() => {
    if (!storageReady) return;
    let active = true;
    const controller = new AbortController();
    const targets = JSON.parse(cycleHistoryKey) as { symbol: string; market: string; start: string; end: string }[];
    const load = async () => {
      if (!targets.length) { setCycleHistoryState("尚無持倉或交易閉環"); return; }
      setCycleHistoryState(`正在同步 ${targets.length} 個標的的 OHLC 日線…`);
      const rows = [] as { bars: HistoryBar[]; error: string | null }[];
      for (const target of targets) {
        if (!active) return;
        const providerSymbol = toProviderSymbol(target.symbol, target.market);
        const today = new Date().toISOString().slice(0, 10);
        const params = new URLSearchParams({ symbol: providerSymbol, datasetSymbol: target.symbol, start: target.start, end: target.end < today ? target.end : today, mode: "ohlc" });
        try {
          const payload = await fetchHistoryInBackground(`/api/history?${params}`, controller.signal);
          rows.push({ bars: payload.bars as HistoryBar[], error: null });
        } catch (error) {
          rows.push({ bars: [] as HistoryBar[], error: `${target.symbol}：${error instanceof Error ? error.message : "讀取失敗"}` });
        }
      }
      if (!active) return;
      const bars = rows.flatMap((row) => row.bars);
      const errors = rows.flatMap((row) => row.error ? [row.error] : []);
      startTransition(() => {
        if (bars.length) setData((current) => ({ ...current, marketBars: mergeMarketBars(current.marketBars || [], bars) }));
        setCycleHistoryState(errors.length ? `背景已更新 ${targets.length - errors.length}/${targets.length} 個標的；${errors.length} 個失敗` : `背景已更新 ${targets.length} 個標的・${bars.length} 筆持倉及出場後日線`);
      });
    };
    load();
    return () => { active = false; controller.abort(); };
  }, [cycleHistoryKey, cycleHistoryRefresh, storageReady, activeRecordAccountId]);

  const fxQuote = quotes[USDTWD_SYMBOL];
  const fxStale = !fxQuote || isQuoteStale(fxQuote.updatedAt, Date.now());
  const fxRate = fxQuote?.price > 0 ? fxQuote.price : null; // Saved FX remains usable, with its stale/as-of label.
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
  const currentEquity = useMemo(() => buildCurrentEquity(data, quotes, fxRate, new Date(lastQuoteAt || Date.now())), [data, quotes, fxRate, lastQuoteAt]);
  const weeklyPerformance = useMemo(() => buildWeeklyPerformance(weeklyEquity, benchmarkDataSymbol === benchmarkSymbol ? benchmarkBars : []), [weeklyEquity, benchmarkBars, benchmarkDataSymbol, benchmarkSymbol]);
  const monthKey = currentMonthKey();
  const monthAssetDelta = useMemo(() => monthlyAssetChange([...weeklyEquity, currentEquity], monthKey), [weeklyEquity, currentEquity, monthKey]);
  const weeklyCycleSummaries = useMemo(() => weeklyCycleStats(report.cycles, fxRate), [report.cycles, fxRate]);
  const rapidRepurchases = useMemo(() => findRapidRepurchases(report.cycles, 3), [report.cycles]);
  const cycleReviews = useMemo(() => linkedCycleReviews(report.cycles, data.positionPlans || {}, data.cycleReviews || {}), [data.cycleReviews, data.positionPlans, report.cycles]);
  const selectedCycle = selectedCycleId ? report.cycles.find((cycle: any) => cycle.id === selectedCycleId) || null : null;
  const selectedPosition = selectedPositionId ? report.positions.find((position: any) => position.id === selectedPositionId) || null : null;
  const selectedPositionClosedCycle = selectedPositionId && !selectedPosition ? report.cycles.find((cycle: any) => cycle.id === selectedPositionId) || null : null;

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
    if (pendingImport.kind === "TradingView CSV" && !(imported.cashActivities || []).length) {
      imported = preserveExistingCashOnFillImport(imported, data);
    }
    setBenchmarkInput(imported.settings?.benchmarkSymbol || "SPY");
    setStorageConflict(false);
    loadDataset(imported);
    setMessage(`已匯入 ${imported.fills.length} 筆成交；現金沿用目前 Trader X2 的 ${(imported.cashActivities || []).length} 筆資金活動。`);
    setPendingImport(null);
  }

  function exportJson() { const url = URL.createObjectURL(new Blob([JSON.stringify(completeSnapshot, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `trade-review-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); setMessage("JSON 備份已下載。"); }
  async function switchRecordAccount(accountId: string) {
    if (!accountId || accountId === activeRecordAccountId) return;
    setCloudReady(false);
    setSaveState("正在切換並載入最新交易紀錄…");
    try {
      await flushRecordBeforeSwitch();
      const response = await fetch(`/api/trade-records?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setActiveRecordAccountId(accountId);
      const recovery = readPendingRecord(browserRecordStorage(), STORAGE_KEY, accountId, payload.dataset);
      loadDataset(recovery.dataset);
      setStorageConflict(Boolean(recovery.conflict));
      recordVersionRef.current = payload.account.version;
      lastSavedJsonRef.current = recovery.conflict ? recovery.baselineJson : completeTradeJson(payload.dataset);
      try { localStorage.setItem(RECORD_ACCOUNT_KEY, accountId); } catch { /* Preferences must not block account loading. */ }
      setSaveState(recovery.conflict ? "本機未同步紀錄與資料庫不同；請先匯出備份再確認版本" : `已載入最新紀錄・${localDateTime(payload.account.updatedAt)}`);
      setMessage(`已切換至「${payload.account.name}」。`);
    } catch (error) {
      setSaveState(`帳號切換失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
    } finally {
      setCloudReady(true);
    }
  }
  async function flushRecordBeforeSwitch() {
    await persistCompleteSnapshot(false, "切換前");
  }
  async function createRecordAccount() {
    const name = window.prompt("請輸入新交易帳號名稱");
    if (!name?.trim()) return;
    const accountName = name.trim().slice(0, 100);
    const accountId = makeRecordAccountId(accountName);
    const accountData: Dataset = { ...structuredClone(emptyData), profile: { ...emptyData.profile, name: accountName } };
    setCloudReady(false);
    setSaveState("正在建立交易帳號…");
    try {
      await flushRecordBeforeSwitch();
      const response = await fetch("/api/trade-records", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, accountName, dataset: accountData }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setRecordAccounts((current) => [payload.account, ...current]);
      setActiveRecordAccountId(accountId);
      setStorageConflict(false);
      loadDataset(accountData);
      recordVersionRef.current = payload.account.version;
      lastSavedJsonRef.current = completeTradeJson(accountData);
      try { localStorage.setItem(RECORD_ACCOUNT_KEY, accountId); } catch { /* Preferences must not block account loading. */ }
      setSaveState(`帳號已建立並自動儲存・${new Date(payload.account.updatedAt).toLocaleTimeString("zh-TW", { hour12: false })}`);
      setMessage(`已建立「${accountName}」，可開始匯入或新增交易。`);
      setCloudReady(true);
    } catch (error) {
      setSaveState(`建立失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
      setCloudReady(true);
    }
  }
  function openEntry() {
    setData((current) => current.entryDraft ? current : { ...current, entryDraft: { ...createEntryDraft(current.accounts), quoteSnapshot: { quotes, capturedAt: new Date().toISOString() } } });
    changePage("entry");
  }
  function submitEntry() {
    if (!data.entryDraft) throw new Error("登錄草稿不存在，請重新開啟");
    const next = commitEntry(data, data.entryDraft, data.entryDraft.quoteSnapshot || { quotes: {}, capturedAt: new Date().toISOString() }) as Dataset;
    setData(next);
    setMessage("已一次登錄成交、計畫與勾選證據；缺項保留為待補，背景自動儲存中。");
    changePage("overview");
  }
  function deleteFill(id: string) { setData({ ...data, fills: data.fills.filter((fill) => fill.id !== id) }); setMessage("成交紀錄已刪除。"); }
  function applyBenchmark(event: React.FormEvent) { event.preventDefault(); const symbol = benchmarkInput.trim().toUpperCase(); if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) { setBenchmarkState("請輸入有效的 ETF 代號"); return; } setData({ ...data, settings: { ...(data.settings || { quoteProvider: "json" }), benchmarkSymbol: symbol } }); }
  function updatePositionPlan(position: { id?: string; accountId: string; symbol: string }, field: PositionPlanField, rawValue: string) {
    const key = positionPlanKey(position);
    const value = field === "note" ? rawValue : rawValue === "" ? null : Number(rawValue);
    planCommitPendingRef.current.add(`${key}:${field}`);
    setData((current) => {
      const existing = positionPlanFor(current.positionPlans || {}, position);
      return { ...current, positionPlans: { ...(current.positionPlans || {}), [key]: { ...existing, [field]: typeof value === "string" || typeof value === "number" && Number.isFinite(value) ? value : null, updatedAt: new Date().toISOString() } } };
    });
  }
  function commitPositionPlan(position: { id?: string; accountId: string; symbol: string }, field: PositionPlanField) {
    const pendingKey = `${positionPlanKey(position)}:${field}`;
    if (!planCommitPendingRef.current.delete(pendingKey)) return;
    const createdAt = new Date().toISOString();
    setData((current) => {
      const value = positionPlanFor(current.positionPlans || {}, position)?.[field] ?? null;
      const version: PlanVersion = { id: `plan-open-${position.accountId}-${position.symbol}-${field}-${Date.now()}`, cycleId: position.id, accountId: position.accountId, symbol: position.symbol, field: field === "note" ? "invalidation" : field, value, reason: field === "note" ? "持倉計畫與失效條件" : "持倉表設定", effectiveAt: createdAt, createdAt, source: "USER" };
      return { ...current, planHistory: [...(current.planHistory || []), version] };
    });
    setMessage(`已保留 ${position.symbol} ${field === "stopLoss" ? "停損" : field === "takeProfit" ? "停利" : "失效條件"}的新計畫版本，平倉後會連結至交易閉環。`);
  }
  function updateCycleReview(cycleId: string, field: CycleReviewField, rawValue: string) {
    const isQualityRating = field === "entryQualityTag" || field === "exitQualityTag";
    if (isQualityRating) {
      setData((current) => ({ ...current, cycleReviews: { ...(current.cycleReviews || {}), [cycleId]: updateQualityRating(current.cycleReviews?.[cycleId] || {}, field, rawValue) } }));
      return;
    }
    const value = field === "plannedStop" || field === "revisedStop" ? rawValue === "" ? null : Number(rawValue) : rawValue;
    const updatedAt = new Date().toISOString();
    setData((current) => ({ ...current, cycleReviews: { ...(current.cycleReviews || {}), [cycleId]: { ...(current.cycleReviews?.[cycleId] || {}), [field]: typeof value === "string" || typeof value === "number" && Number.isFinite(value) ? value : null, updatedAt } } }));
  }
  function toggleDecisionLink(pairKey: string) {
    setData((current) => {
      const linked = !(current.decisionLinks?.[pairKey]?.linked);
      const updatedAt = new Date().toISOString();
      return { ...current, decisionLinks: { ...(current.decisionLinks || {}), [pairKey]: { linked, updatedAt } }, decisionLinkHistory: [...(current.decisionLinkHistory || []), { pairKey, linked, updatedAt }] };
    });
  }
  function addPlanVersion(version: PlanVersion) {
    setData((current) => ({ ...current, planHistory: [...(current.planHistory || []), version] }));
    setMessage(`已新增 ${version.symbol} ${version.field === "stopLoss" ? "停損" : version.field === "takeProfit" ? "停利" : "失效條件"}版本，舊版本已保留。`);
  }
  function assignStrategy(cycle: any, strategyId: string, source = "OPEN_POSITION") {
    const strategy = (data.strategies || []).find((item) => item.id === strategyId);
    if (!strategy) return;
    setData((current) => ({ ...current, strategyAssignments: { ...(current.strategyAssignments || {}), [cycle.id]: createStrategyAssignment(cycle, strategy, source) } }));
    setMessage(`已將「${strategy.name}」固定版本指派給 ${cycle.symbol}。`);
  }
  function updateStrategyAudit(cycleId: string, phase: "pre" | "post", ruleId: string, status: string, note: string) {
    setData((current) => {
      const assignment = current.strategyAssignments?.[cycleId];
      if (!assignment) return current;
      return { ...current, strategyAssignments: { ...(current.strategyAssignments || {}), [cycleId]: updateStrategyCheck(assignment, phase, ruleId, status, note) } };
    });
  }
  const metrics = [
    ["目前總資產", currentEquity.totalUsd == null ? "匯率待更新" : money(currentEquity.totalUsd), ""],
    ["總損益（USD等值）", totalUsd == null ? "匯率待更新" : money(totalUsd), moneyByCurrency(totalPnlByCurrency)],
    ["已實現（USD等值）", realizedUsd == null ? "匯率待更新" : money(realizedUsd), moneyByCurrency(report.realizedPnlByCurrency)],
    ["完整閉環", report.cycles.length, `${report.positions.length} 個未平倉部位`],
    ["成交紀錄", data.fills.length, `${(data.cashActivities || []).length} 筆資金活動`],
    ["測試結果", `${tests.filter((test: any) => test.passed).length}/${tests.length}`, tests.every((test: any) => test.passed) ? "目前全部通過" : "需要修正"],
  ];
  const hasDataErrors = report.issues.some((issue: any) => issue.level === "error");
  const saveFailed = /失敗|無法|尚未完成|衝突|停止覆寫/.test(saveState);
  const messageFailed = /失敗|無法|錯誤/.test(message);
  const noticeTone = hasDataErrors || messageFailed || saveFailed ? "error" : report.qualityPct < 100 || report.issues.length ? "warning" : "info";
  const noticeMessage = saveFailed ? saveState : message.startsWith("資料已從本機") ? "計算與資料完整度分開呈現；行情缺漏不補造價格。" : message;
  const title = tab === "entry" ? "新增交易" : tab === "overview" || tab === "positions" ? "持倉總覽" : tab === "performance" ? "績效分析" : tab === "trades" ? "成交與資金資料" : tab === "cycles" ? "交易閉環" : tab === "strategies" ? "策略管理" : tab === "training" ? "交易行為分析" : "測試中心";

  return <div className="shell">
    <a className="skip-link" href="#workspace-main">跳至主要內容</a>
    <aside className="sidebar">
      <div className="brand"><span>TR</span><strong>交易復盤顧問</strong></div>
      <button className="mobile-nav-toggle" type="button" aria-expanded={navOpen} aria-controls="primary-navigation" onClick={() => setNavOpen((open) => !open)}><span>{title}</span><span>{navOpen ? "收合導覽 −" : "展開導覽 ＋"}</span></button>
      <nav id="primary-navigation" className={navOpen ? "is-open" : ""} aria-label="主要導覽">{[["overview", "持倉總覽"], ["performance", "績效"], ["trades", "成交資料"], ["cycles", "交易閉環"], ["strategies", "策略管理"], ["training", "交易行為分析"], ["tests", "測試中心"]].map(([key, label]) => <button key={key} className={(tab === "positions" ? "overview" : tab) === key ? "active" : ""} aria-current={(tab === "positions" ? "overview" : tab) === key ? "page" : undefined} onClick={() => changePage(key)}>{label}</button>)}</nav>
      <div className="provider"><span>行情來源</span><b>市場行情適配器</b><small>持倉與USDTWD每30秒更新；閉環 OHLC 日線自動同步並自動儲存。</small></div>
      <div className="local-note">完整交易資料與行情快照<br/><b>手動儲存＋背景自動儲存</b></div>
    </aside>
    <main className="content" id="workspace-main" tabIndex={-1}>
      <header className="topbar"><div><h1>{title}</h1></div><div className="actions"><input ref={inputRef} hidden type="file" accept=".json,.csv,application/json,text/csv" onChange={(event) => prepareImport(event.target.files?.[0])}/><button className="ghost" disabled={!storageReady} onClick={() => inputRef.current?.click()}>匯入 JSON／CSV</button><button type="button" className="ghost" disabled={!storageReady || !cloudReady || storageConflict || manualSaving} aria-busy={manualSaving} title="將目前帳號的完整資料寫入儲存位置，包含已載入的行情與匯率" onClick={() => void manualSave()}>{manualSaving ? "儲存中…" : "立即儲存"}</button><button className="ghost" disabled={!storageReady} onClick={exportJson}>匯出備份</button><button className="primary" disabled={!storageReady} onClick={openEntry}>新增交易</button></div></header>
      <section className="account-store" aria-label="交易帳號資料庫">
        <div><span>交易帳號</span><select aria-label="交易帳號" value={activeRecordAccountId} disabled={!storageReady || !cloudReady || manualSaving || !recordAccounts.length} onChange={(event) => void switchRecordAccount(event.target.value)}>{recordAccounts.length ? recordAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>) : <option value={activeRecordAccountId}>主要交易帳號</option>}</select><button className="ghost" type="button" onClick={() => void createRecordAccount()} disabled={!storageReady || !cloudReady || manualSaving}>＋ 新增帳號</button></div>
        <p role="status" aria-live="polite" className={saveFailed ? "save-error" : ""}><span className="save-dot"/> {saveState}</p>
      </section>
      <div className={`notice notice-${noticeTone}`} role={noticeTone === "error" ? "alert" : "status"}>
        <b>{!storageReady ? "資料載入中" : hasDataErrors ? "資料需要處理" : saveFailed ? "帳號同步需處理" : messageFailed ? "操作未完成" : !data.fills.length ? "尚無成交資料" : report.qualityPct < 100 || report.issues.length ? "資料仍需補齊" : "計算完成"}</b>
        <span>{storageReady ? noticeMessage : "正在讀取這個帳號的紀錄，請稍候。"}</span>
        {storageReady && <button type="button" className="notice-quality" onClick={() => changePage("tests")}>資料完整度 {report.qualityPct}% · 查看檢查</button>}
      </div>
      <div id="workspace-content" aria-busy={!storageReady}>
      {!storageReady ? <div className="workspace-loading" role="status"><span/><span/><span/><p>正在載入交易紀錄…</p></div> : <>
      {(tab === "overview" || tab === "positions") && <>
        <section className="quote-bar"><div><span className="live-dot"/> <b>持倉報價</b><small className={/失敗|無法/.test(quoteState) ? "negative" : ""}>{quoteState}</small><span className={`data-quality-light ${report.issues.some((issue: any) => issue.level === "error") ? "bad" : report.qualityPct === 100 ? "good" : "warn"}`} role="status" aria-label={`資料品質 ${report.qualityPct}%`} title={`資料品質 ${report.qualityPct}%`}/></div><div className="fx-rate" title={fxQuote ? `報價時間：${localDateTime(fxQuote.updatedAt)}` : "尚無匯率資料"}><span>USDTWD</span><b>{fxQuote ? fxQuote.price.toFixed(4) : "—"}</b><small className={fxStale ? "negative" : "positive"}>{fxQuote ? fxStale ? "使用上次匯率（待更新）" : "目前匯率" : /失敗|無法/.test(quoteState) ? "缺少匯率" : "正在取得匯率"}</small></div><QuoteRefreshStatus lastQuoteAt={lastQuoteAt}/></section>
        <section className="panel overview-section" id="overview-assets" aria-labelledby="overview-assets-title">
          <header className="overview-section-head"><h2 id="overview-assets-title">資產</h2></header>
          <section className="metrics">{metrics.slice(0, 3).map(([label, value, hint]) => <article key={String(label)}><span>{label}</span><strong>{value}</strong>{label === "目前總資產" ? <EquityBreakdown equity={currentEquity}/> : <small>{hint}</small>}</article>)}</section>
          <section className="secondary-metrics" aria-label="帳本與系統摘要">{metrics.slice(3).map(([label, value, hint]) => <div key={String(label)}><span>{label} <b>{value}</b></span><small>{hint}</small></div>)}</section>
          <OverviewDisclosure key={`assets-${activeRecordAccountId}`} id="overview-monthly-assets" label="逐月資產變化圖">
            <MonthlyAssets data={data} quotes={quotes} fxRate={fxRate} asOf={currentEquity.asOf}/>
          </OverviewDisclosure>
        </section>
        <section className="panel overview-section" id="overview-holdings" aria-labelledby="overview-holdings-title">
          <header className="overview-section-head"><h2 id="overview-holdings-title">持倉</h2></header>
          <PositionOverview positions={report.positions} quotes={quotes} plans={data.positionPlans || {}} totalAssetUsd={currentEquity.totalUsd} fxRate={fxRate}/>
          <OverviewDisclosure key={`holdings-${activeRecordAccountId}`} id="overview-position-plans" label={`全部持倉與計畫編輯（${report.positions.length} 個部位）`}>
            <PositionsPanel positions={report.positions} quotes={quotes} plans={data.positionPlans || {}} accounts={data.accounts} totalAssetUsd={currentEquity.totalUsd} fxRate={fxRate} onPlanChange={updatePositionPlan} onPlanCommit={commitPositionPlan} onOpenChart={openPositionChart}/>
          </OverviewDisclosure>
        </section>
        <TradeMetrics key={activeRecordAccountId} cycles={report.cycles} monthKey={monthKey} fxRate={fxRate} onSelect={(cycle) => setSelectedCycleId(cycle.id)}/>
      </>}
      {tab === "entry" && (data.entryDraft ? <TradeEntryWorkspace key={activeRecordAccountId} data={data} draft={data.entryDraft} quotes={quotes} onChange={(patch) => setData((current) => current.entryDraft?.id === data.entryDraft?.id ? ({ ...current, entryDraft: { ...current.entryDraft, ...patch } }) : current)} onSubmit={submitEntry} onBack={() => changePage("overview")}/> : <div className="panel"><p>這個帳號沒有待填草稿。</p><button className="primary" onClick={openEntry}>開始登錄成交</button></div>)}
      {tab === "performance" && <PerformancePanel points={weeklyPerformance} currentEquity={currentEquity} monthAssetDelta={monthAssetDelta} monthKey={monthKey} benchmarkSymbol={benchmarkSymbol} benchmarkInput={benchmarkInput} setBenchmarkInput={setBenchmarkInput} benchmarkState={benchmarkState} applyBenchmark={applyBenchmark} fxRate={fxQuote?.price || null}/>}
      {tab === "trades" && <><div className="ledger-switch" role="group" aria-label="帳本內容"><button type="button" aria-pressed={ledgerTab === "fills"} onClick={() => setLedgerTab("fills")}>成交紀錄 <span>{data.fills.length}</span></button><button type="button" aria-pressed={ledgerTab === "cash"} onClick={() => setLedgerTab("cash")}>資金活動 <span>{(data.cashActivities || []).length}</span></button></div>{ledgerTab === "fills" ? <section className="panel"><div className="panel-head"><div><h2>個人成交帳本</h2></div><span className="muted">依成交時間排序</span></div><div className="table-wrap" tabIndex={0} role="region" aria-label="資料表，可捲動"><table className="fills-table"><thead><tr><th>日期</th><th>標的</th><th>方向</th><th>數量</th><th>價格</th><th>費用</th><th>操作</th></tr></thead><tbody>{[...data.fills].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map((fill) => <tr key={fill.id}><td>{fill.timestamp.slice(0, 10)}</td><td><b>{fill.symbol}</b><small className="block">{fill.market}</small></td><td><span className={`side ${fill.side.toLowerCase()}`}>{fill.side === "BUY" ? "買進" : "賣出"}</span></td><td>{fill.quantity}</td><td>{money(fill.price, fill.currency)}</td><td>{money(fill.fee, fill.currency)}</td><td><button className="danger" onClick={() => deleteFill(fill.id)}>刪除</button></td></tr>)}</tbody></table></div></section> : <CashLedger activities={data.cashActivities || []} accounts={data.accounts}/>}</>}
      {tab === "cycles" && <><CycleTable cycles={report.cycles} title="全部交易閉環" historyState={cycleHistoryState} onRefresh={() => setCycleHistoryRefresh((value) => value + 1)} onSelect={(cycle) => setSelectedCycleId(cycle.id)}/><WeeklyCyclePanel stats={weeklyCycleSummaries}/></>}
      {tab === "strategies" && <StrategyWorkspace strategies={data.strategies || []} assignments={data.strategyAssignments || {}} cycles={report.cycles} fxRate={fxRate} onStrategiesChange={(strategies) => setData((current) => ({ ...current, strategies }))} onAssignmentsChange={(strategyAssignments) => setData((current) => ({ ...current, strategyAssignments }))} onSelectCycle={(cycleId) => setSelectedCycleId(cycleId)}/>}
      {tab === "training" && <TrainingWorkspace cycles={report.cycles} marketBars={data.marketBars} reviews={cycleReviews} fxRate={fxRate} strategies={data.strategies || []} strategyAssignments={data.strategyAssignments || {}} entryContexts={data.entryContexts || {}} onSelectCycle={(cycleId) => setSelectedCycleId(cycleId)} onQualityRatingChange={updateCycleReview}/>}
      {tab === "tests" && <section className="split tests"><article className="panel"><h2>核心計算測試</h2><div className="test-list">{tests.map((test: any) => <div key={test.name}><span className={`test-result ${test.passed ? "pass" : "fail"}`}>{test.passed ? "通過" : "失敗"}</span><b>{test.name}</b><small>{test.detail || "通過"}</small></div>)}</div></article><article className="panel"><h2>目前資料檢查</h2>{report.issues.length ? <div className="test-list">{report.issues.map((issue: any, index: number) => <div key={`${issue.code}-${index}`}><span className={`test-result ${issue.level === "error" ? "fail" : "warn-dot"}`}>{issue.level === "error" ? "失敗" : "警告"}</span><b>{issue.code}</b><small>{issue.message}</small></div>)}</div> : <Empty text="沒有發現資料問題"/>}</article></section>}
      </>}
      </div>
    </main>
    {pendingImport && <DialogFrame label="匯入資料確認" onClose={() => setPendingImport(null)}><div className="modal import-modal"><div className="panel-head dialog-header"><div><h2>確認匯入資料</h2></div><button type="button" className="close" aria-label="關閉視窗" onClick={() => setPendingImport(null)}>×</button></div><p className="modal-copy">確認後將取代目前交易帳號的帳本，並沿用現有自動儲存流程。請先確認帳號與備份；取消不會修改資料。</p><div className="import-summary"><article><span>格式</span><b>{pendingImport.kind}</b><small>{pendingImport.fileName}</small></article><article><span>成交</span><b>{pendingImport.dataset.fills.length}</b><small>{pendingImport.duplicateCount} 筆與目前ID相同</small></article><article><span>資金活動</span><b>{(pendingImport.dataset.cashActivities || []).length}</b><small>{(pendingImport.dataset.cashActivities || []).filter((activity) => activity.requiresReview).length} 筆待指定幣別</small></article><article><span>行情日線</span><b>{pendingImport.dataset.marketBars.length}</b><small>CSV會保留可匹配的既有日線</small></article></div>{(pendingImport.dataset.cashActivities || []).some((activity) => activity.requiresReview) && <label className="cash-choice">待確認資金活動幣別<select value={cashCurrency} onChange={(event) => setCashCurrency(event.target.value)}><option value="USD">USD 美元</option><option value="TWD">TWD 台幣</option></select></label>}{pendingImport.warnings.length > 0 && <div className="import-warnings"><b>資料提醒</b>{pendingImport.warnings.map((warning, index) => <p key={index}>• {warning}</p>)}</div>}<div className="modal-actions"><button type="button" className="ghost" onClick={() => setPendingImport(null)}>取消</button><button type="button" className="primary" onClick={confirmImport}>確認匯入並取代</button></div></div></DialogFrame>}
    {selectedCycle && <CycleDetail entryContexts={data.entryContexts || {}} cycle={selectedCycle} marketBars={data.marketBars} review={cycleReviews[selectedCycle.id] || {}} planHistory={data.planHistory || []} rapidPairs={rapidRepurchases} cycles={report.cycles} decisionLinks={data.decisionLinks || {}} decisionLinkHistory={data.decisionLinkHistory || []} strategies={data.strategies || []} strategyAssignments={data.strategyAssignments || {}} onAssignStrategy={assignStrategy} onStrategyCheck={updateStrategyAudit} onAddPlanVersion={addPlanVersion} onReviewChange={updateCycleReview} onToggleDecisionLink={toggleDecisionLink} onClose={() => setSelectedCycleId(null)}/>}
    {selectedPosition && <OpenPositionDetail entryContexts={data.entryContexts || {}} key={`${selectedPosition.id}:${positionEventId || "latest"}`} initialEventId={positionEventId} position={selectedPosition} plan={positionPlanFor(data.positionPlans || {}, selectedPosition)} marketBars={data.marketBars} planHistory={data.planHistory || []} strategies={data.strategies || []} strategyAssignments={data.strategyAssignments || {}} onAssignStrategy={assignStrategy} onStrategyCheck={updateStrategyAudit} onAddPlanVersion={addPlanVersion} onPlanChange={updatePositionPlan} onPlanCommit={commitPositionPlan} onOpenAnalysis={() => { setSelectedPositionId(null); setTab("training"); }} onClose={() => setSelectedPositionId(null)}/>}
    {selectedPositionClosedCycle && <CycleDetail entryContexts={data.entryContexts || {}} cycle={selectedPositionClosedCycle} marketBars={data.marketBars} review={cycleReviews[selectedPositionClosedCycle.id] || {}} planHistory={data.planHistory || []} rapidPairs={rapidRepurchases} cycles={report.cycles} decisionLinks={data.decisionLinks || {}} decisionLinkHistory={data.decisionLinkHistory || []} strategies={data.strategies || []} strategyAssignments={data.strategyAssignments || {}} onAssignStrategy={assignStrategy} onStrategyCheck={updateStrategyAudit} onAddPlanVersion={addPlanVersion} onReviewChange={updateCycleReview} onToggleDecisionLink={toggleDecisionLink} onClose={() => setSelectedPositionId(null)}/>}
  </div>;
}

type PerformancePoint = { weekStart: string; asOf: string; totalUsd: number | null; portfolioPct: number | null; benchmarkPct: number | null };
type MonthScore = { cycles: any[]; averageReturn: number | null; averageWinningReturn: number | null; averageLosingReturn: number | null; averageWinningAmountUsd: number | null; averageLosingAmountUsd: number | null; totalPnlUsd: number | null; winners: number; losers: number; flat: number; winRate: number | null };

function positionRows(positions: any[], quotes: Record<string, Quote>, plans: Record<string, PositionPlan>, totalAssetUsd: number | null, fxRate: number | null) {
  const rows = positions.map((position) => {
    const quote = quotes[toProviderSymbol(position.symbol, position.market)];
    const plan = positionPlanFor(plans, position);
    const metrics = buildPositionMetrics(position, quote?.price, plan.stopLoss, totalAssetUsd, fxRate, plan.takeProfit);
    return { position, quote, plan, metrics };
  });
  const grossPositionValueUsd = rows.reduce((sum, row) => sum + (row.metrics.marketValueUsd || 0), 0);
  return rows.map((row) => ({ ...row, metrics: { ...row.metrics, takeProfitPortfolioPct: positionPortfolioImpactPct(row.metrics.takeProfitOutcomeUsd, grossPositionValueUsd), stopPortfolioPct: positionPortfolioImpactPct(row.metrics.stopOutcomeUsd, grossPositionValueUsd) } })).sort((a, b) => (b.metrics.allocationPct ?? -1) - (a.metrics.allocationPct ?? -1));
}

function PositionOverview({ positions, quotes, plans, totalAssetUsd, fxRate }: { positions: any[]; quotes: Record<string, Quote>; plans: Record<string, PositionPlan>; totalAssetUsd: number | null; fxRate: number | null }) {
  const rows = positionRows(positions, quotes, plans, totalAssetUsd, fxRate);
  const planned = rows.filter(({ plan }) => Number(plan.stopLoss) > 0).length;
  const alerts = rows.filter(({ metrics }) => metrics.stopBreached).length;
  return <article className="panel position-overview"><div className="panel-head"><div><h3>持倉風險摘要</h3></div></div><div className="position-overview-grid"><div><span>未平倉部位</span><b>{rows.length}</b><small>依即時市值排序</small></div><div><span>已設定停損</span><b>{planned}/{rows.length}</b><small>停損計畫隨帳號儲存</small></div><div><span>停損警示</span><b className={alerts ? "negative" : "positive"}>{alerts}</b><small>{alerts ? "已有價格越過停損" : "目前沒有觸發"}</small></div><div><span>最大持倉</span><b>{rows[0]?.position.symbol || "—"}</b><small>{rows[0]?.metrics.allocationPct == null ? "佔比待更新" : `${(rows[0].metrics.allocationPct * 100).toFixed(1)}% 總資產`}</small></div></div></article>;
}

function PositionsPanel({ positions, quotes, plans, accounts, totalAssetUsd, fxRate, onPlanChange, onPlanCommit, onOpenChart }: { positions: any[]; quotes: Record<string, Quote>; plans: Record<string, PositionPlan>; accounts: Dataset["accounts"]; totalAssetUsd: number | null; fxRate: number | null; onPlanChange: (position: any, field: PositionPlanField, value: string) => void; onPlanCommit: (position: any, field: PositionPlanField) => void; onOpenChart: (position: any, eventId?: string) => void }) {
  const [expandedPositions, setExpandedPositions] = useState<Set<string>>(() => new Set());
  function togglePosition(id: string) {
    setExpandedPositions((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const rows = positionRows(positions, quotes, plans, totalAssetUsd, fxRate);
  const accountNames = Object.fromEntries(accounts.map((account) => [account.id, account.name]));

  return <><div className="position-plan-notice"><b>停利／停損為個人交易計畫</b><span>下方盈虧比率＝計畫價相對即時價的預估盈虧 ÷ 全部未平倉部位總市值；計畫會沿同一筆交易 ID 進入閉環與行為分析。</span></div><article className="panel positions-panel"><div className="panel-head"><div><h3>全部持倉計畫</h3></div><span className="muted">依持倉佔比排序・{positions.length} 個未平倉部位</span></div>{rows.length ? <div className="table-wrap positions-wrap" tabIndex={0} role="region" aria-label="持倉明細，可橫向捲動"><table className="positions-table"><thead><tr className="column-groups"><th colSpan={4} scope="colgroup">標的與帳戶</th><th colSpan={3} scope="colgroup">持倉與市值</th><th scope="colgroup">損益</th><th colSpan={6} scope="colgroup">交易計畫與風險</th></tr><tr><th>排名</th><th>狀態</th><th>標的／部位</th><th>帳戶</th><th>即時價</th><th>部位金額</th><th>持倉佔比</th><th>未實現損益</th><th>停利價／總持倉盈虧</th><th>停損價／總持倉盈虧</th><th>距停損</th><th>預估停損風險</th><th>即時風險報酬比</th><th>計畫／K線</th></tr></thead><tbody>{rows.map(({ position, quote, plan, metrics }, index) => <Fragment key={positionPlanKey(position)}><tr className={`${metrics.stopBreached ? "stop-breached" : ""} ${expandedPositions.has(position.id) ? "position-expanded" : ""}`}><td className="rank-cell">{index + 1}</td><td><span className={`stop-light ${metrics.stopBreached ? "breach" : "safe"}`} title={metrics.stopBreached ? "即時價格已越過停損價位" : "尚未觸發停損"}/><small className={metrics.stopBreached ? "negative block" : "muted block"}>{metrics.stopBreached ? "停損觸發" : "正常"}</small></td><td><b>{position.symbol} <span className={`direction ${position.direction.toLowerCase()}`}>{position.direction === "SHORT" ? "空" : "多"}</span></b><small className="block">{position.quantity} 股・均價 {money(position.averageCost, position.currency)}</small><button type="button" className="position-ledger-toggle" aria-expanded={expandedPositions.has(position.id)} aria-controls={`position-ledger-${encodeURIComponent(position.id)}`} aria-label={`${position.symbol} 交易紀錄 ${position.fills?.length || 0} 筆`} onClick={() => togglePosition(position.id)}><span aria-hidden="true">{expandedPositions.has(position.id) ? "▾" : "▸"}</span>交易紀錄 · {position.fills?.length || 0} 筆</button></td><td><b>{accountNames[position.accountId] || position.accountId}</b><small className="block">{position.currency}</small></td><td><b>{quote ? money(quote.price, position.currency) : "更新中"}</b><small className={quote?.changePct != null && quote.changePct >= 0 ? "positive block" : "negative block"}>{quote?.changePct == null ? "—" : pct(quote.changePct)}</small></td><td><b>{metrics.marketValue == null ? "—" : money(metrics.marketValue, position.currency)}</b><small className="block">{usdOrDash(metrics.marketValueUsd)}</small></td><td><b>{metrics.allocationPct == null ? "—" : `${(metrics.allocationPct * 100).toFixed(1)}%`}</b><small className="block">部位市值 ÷ 總資產</small></td><td><b className={metrics.unrealized == null ? "" : metrics.unrealized >= 0 ? "positive" : "negative"}>{metrics.unrealized == null ? "—" : money(metrics.unrealized, position.currency)}</b><small className="block">{usdOrDash(metrics.unrealizedUsd)}</small></td><td><label className="position-price-input"><input aria-label={`${position.symbol} 停利價`} type="number" min="0" step="any" value={plan.takeProfit ?? ""} placeholder="—" onChange={(event) => onPlanChange(position, "takeProfit", event.target.value)} onBlur={() => onPlanCommit(position, "takeProfit")}/><small>{position.currency}</small><em className={metrics.takeProfitPortfolioPct == null ? "" : metrics.takeProfitPortfolioPct >= 0 ? "positive" : "negative"}>{metrics.takeProfitPortfolioPct == null ? "尚未設定" : `總持倉 ${pct(metrics.takeProfitPortfolioPct)}`}</em></label></td><td><label className="position-price-input"><input aria-label={`${position.symbol} 停損價`} type="number" min="0" step="any" value={plan.stopLoss ?? ""} placeholder="—" onChange={(event) => onPlanChange(position, "stopLoss", event.target.value)} onBlur={() => onPlanCommit(position, "stopLoss")}/><small>{position.currency}</small><em className={metrics.stopPortfolioPct == null ? "" : metrics.stopPortfolioPct >= 0 ? "positive" : "negative"}>{metrics.stopPortfolioPct == null ? "尚未設定" : `總持倉 ${pct(metrics.stopPortfolioPct)}`}</em></label></td><td><b className={metrics.stopDistance == null ? "" : metrics.stopDistance >= 0 ? "" : "negative"}>{metrics.stopDistance == null ? "—" : money(metrics.stopDistance, position.currency)}</b><small className="block">{metrics.stopDistancePct == null ? "尚未設定" : `${(metrics.stopDistancePct * 100).toFixed(1)}%`}</small></td><td><b>{metrics.stopLossAmount == null ? "—" : money(metrics.stopLossAmount, position.currency)}</b><small className="block">{usdOrDash(metrics.stopLossAmountUsd)}</small></td><td><b className={metrics.riskReward == null ? "" : metrics.riskReward >= 0 ? "positive" : "negative"}>{metrics.riskReward == null ? "—" : `${metrics.riskReward.toFixed(2)}x`}</b><small className="block">當下損益 ÷ 停損損失</small></td><td><label className="position-note-input"><input aria-label={`${position.symbol} 計畫備註`} value={plan.note || ""} placeholder="輸入計畫或失效條件" onChange={(event) => onPlanChange(position, "note", event.target.value)} onBlur={() => onPlanCommit(position, "note")}/><small>{localDateTime(plan.updatedAt)}</small><button type="button" className="ghost" onClick={() => onOpenChart(position)}>看進場與停損K線</button></label></td></tr><tr className="position-ledger-row" id={`position-ledger-${encodeURIComponent(position.id)}`} hidden={!expandedPositions.has(position.id)}><td colSpan={14}>{expandedPositions.has(position.id) && <PositionTransactions position={position} accountName={accountNames[position.accountId] || position.accountId} onOpenChart={onOpenChart}/>}</td></tr></Fragment>)}</tbody></table></div> : <Empty text="目前沒有未平倉部位"/>}</article></>;
}

function TradeMetrics({ cycles, monthKey, fxRate, onSelect }: { cycles: any[]; monthKey: string; fxRate: number | null; onSelect: (cycle: any) => void }) {
  const [requestedScope, setScope] = useState("month");
  const scope = requestedScope === "all" || requestedScope === "year" ? requestedScope : "month";
  const [selection, setSelection] = useState<{ year?: string; month?: string }>({});
  const selectedYear = selection.year ?? monthKey.slice(0, 4);
  const selectedMonth = selection.month ?? monthKey;
  const years = useMemo(() => [...new Set([monthKey.slice(0, 4), selectedYear, ...cycles.map(cycle => String(cycle.closeAt || "").slice(0, 4))])].filter(value => /^[1-9]\d{3}$/.test(value)).sort().reverse(), [cycles, monthKey, selectedYear]);
  let start = "", end = "", selectionError = "";
  if (scope === "year") {
    if (/^[1-9]\d{3}$/.test(selectedYear)) { start = `${selectedYear}-01-01`; end = `${selectedYear}-12-31`; }
    else selectionError = "請選擇有效的年份。";
  } else if (scope === "month") {
    if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(selectedMonth)) {
      const [year, month] = selectedMonth.split("-").map(Number);
      start = `${selectedMonth}-01`; end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    } else selectionError = "請選擇有效的月份。";
  }
  const score = useMemo(() => cycleRangeScore(cycles, start, end, fxRate), [cycles, start, end, fxRate]);
  const error = selectionError || score.error;
  const periodLabel = scope === "all" ? "總累積" : scope === "year" ? `${selectedYear}年` : `${selectedMonth.slice(0, 4)}年${Number(selectedMonth.slice(5))}月`;
  return <section className="panel overview-section trade-metrics-section" id="overview-trade-metrics" aria-labelledby="overview-trade-metrics-title">
    <header className="overview-section-head"><h2 id="overview-trade-metrics-title">交易計量</h2><span className="muted">計分表與交易閉環共用區間</span></header>
    <div className="overview-period-controls" role="group" aria-label="交易計量區間">
      <label>資料區間<select aria-label="交易計量資料區間" value={scope} onChange={event => setScope(event.target.value)}><option value="all">總累積</option><option value="year">年</option><option value="month">月</option></select></label>
      {scope === "year" && <label>年份<select aria-label="交易計量年份" value={selectedYear} onChange={event => setSelection(current => ({ ...current, year: event.target.value }))}>{years.map(year => <option key={year} value={year}>{year}年</option>)}</select></label>}
      {scope === "month" && <label>月份<input aria-label="交易計量月份" type="month" min="1000-01" max="9999-12" value={selectedMonth} onChange={event => setSelection(current => ({ ...current, month: event.target.value }))}/></label>}
      <span className="overview-period-summary" role="status">{error ? "請確認區間" : `${periodLabel}・${score.cycles.length} 筆閉環`}</span>
    </div>
    <p className="overview-period-note">依出場日期（帳本 UTC）歸屬年份或月份；調整區間不影響資產與目前持倉。</p>
    {error ? <p className="overview-period-error" role="alert">{error}</p> : <>
      <MonthScorecard score={score}/>
      <CycleTable cycles={score.cycles} title="交易閉環" embedded onSelect={onSelect}/>
    </>}
  </section>;
}

function MonthScorecard({ score }: { score: MonthScore }) {
  return <article className="panel score-panel">
    <div className="panel-head"><div><h3>交易計分表</h3></div><span className="muted">依選取區間的出場日統計</span></div>
    <div className="trade-score-split">
      <section className="trade-score-group profit-score"><div className="trade-score-title"><span>獲利交易計分</span><b className="positive">{score.winners} 筆</b></div><div className="trade-score-metrics"><div><span>交易單數</span><strong>{score.winners}</strong><small>已實現獲利閉環</small></div><div><span>平均獲利率</span><strong className="positive">{pct(score.averageWinningReturn)}</strong><small>獲利交易報酬率平均</small></div><div><span>平均獲利金額</span><strong className="positive amount-value">{usdOrDash(score.averageWinningAmountUsd)}</strong><small>全部換算為美元等值</small></div></div></section>
      <section className="trade-score-group loss-score"><div className="trade-score-title"><span>虧損交易計分</span><b className="negative">{score.losers} 筆</b></div><div className="trade-score-metrics"><div><span>交易單數</span><strong>{score.losers}</strong><small>已實現虧損閉環</small></div><div><span>平均虧損率</span><strong className="negative">{pct(score.averageLosingReturn)}</strong><small>虧損交易報酬率平均</small></div><div><span>平均虧損金額</span><strong className="negative amount-value">{usdOrDash(score.averageLosingAmountUsd)}</strong><small>全部換算為美元等值</small></div></div></section>
    </div>
    <div className="score-summary"><div><span>區間平均報酬率</span><b className={score.averageReturn == null ? "" : score.averageReturn >= 0 ? "positive" : "negative"}>{pct(score.averageReturn)}</b><small>包含全部 {score.cycles.length} 筆區間閉環</small></div><div><span>獲利：虧損（獲利交易率）</span><b>{score.winners}：{score.losers} <em>（{score.winRate == null ? "—" : `${(score.winRate * 100).toFixed(1)}%`}）</em></b><small>{score.flat ? `另有 ${score.flat} 筆損益兩平` : "不含損益兩平"}</small></div><div><span>總盈虧金額</span><b className={score.totalPnlUsd == null ? "" : score.totalPnlUsd >= 0 ? "positive" : "negative"}>{usdOrDash(score.totalPnlUsd)}</b><small>區間已平倉損益，全部換算為美元等值</small></div></div>
  </article>;
}

function PerformancePanel({ points, currentEquity, monthAssetDelta, monthKey, benchmarkSymbol, benchmarkInput, setBenchmarkInput, benchmarkState, applyBenchmark, fxRate }: { points: PerformancePoint[]; currentEquity: { totalUsd: number | null; asOf: string; liveQuoteCount: number; positionCount: number; missingSymbols: string[] }; monthAssetDelta: number | null; monthKey: string; benchmarkSymbol: string; benchmarkInput: string; setBenchmarkInput: (value: string) => void; benchmarkState: string; applyBenchmark: (event: React.FormEvent) => void; fxRate: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visiblePoints = useMemo(() => points.filter((point) => point.portfolioPct != null || point.benchmarkPct != null), [points]);

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
      context.font = "12px system-ui";
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

  return <><section className="performance-summary"><article><span>{monthKey.slice(5)}月資產變化累計差額</span><b className={monthAssetDelta != null && monthAssetDelta >= 0 ? "positive" : "negative"}>{monthAssetDelta == null ? "—" : money(monthAssetDelta)}</b><small>月初前最後有效週資產至目前即時淨值</small></article><article><span>目前總資產</span><b>{currentEquity.totalUsd == null ? "—" : money(Number(currentEquity.totalUsd))}</b><small>{currentEquity.liveQuoteCount === currentEquity.positionCount ? `即時淨值・${new Date(currentEquity.asOf).toLocaleTimeString("zh-TW")}` : `${currentEquity.liveQuoteCount}/${currentEquity.positionCount} 個持倉為即時價`}</small></article><article><span>比較基準</span><b>{benchmarkSymbol}</b><small>{benchmarkState}</small></article></section><article className="panel performance-panel"><div className="panel-head performance-head"><div><h2>每週績效比較</h2></div><form className="benchmark-form" onSubmit={applyBenchmark}><label htmlFor="benchmark">ETF 比較基準</label><input id="benchmark" aria-label="ETF 比較基準" value={benchmarkInput} onChange={(event) => setBenchmarkInput(event.target.value.toUpperCase())} placeholder="例如 SPY"/><button className="primary">套用</button></form></div><div className="chart-legend"><span><i className="portfolio-color"/>我的資產</span><span><i className="benchmark-color"/>{benchmarkSymbol}</span><small>每週相較上週；中央線為 0%</small></div>{visiblePoints.length ? <><canvas ref={canvasRef} className="performance-canvas" role="img" aria-label={`每週資產績效與 ${benchmarkSymbol} 比較，中央為零軸`}>每週績效比較圖</canvas><div className="table-wrap performance-table" tabIndex={0} role="region" aria-label="每週績效資料表，可捲動"><table><thead><tr><th>週起始日</th><th>我的資產</th><th>{benchmarkSymbol}</th><th>週末總資產</th></tr></thead><tbody>{visiblePoints.map((point) => <tr key={point.weekStart}><td>{point.weekStart}</td><td className={point.portfolioPct != null && point.portfolioPct >= 0 ? "positive" : "negative"}>{pct(point.portfolioPct)}</td><td className={point.benchmarkPct != null && point.benchmarkPct >= 0 ? "benchmark-positive" : "negative"}>{pct(point.benchmarkPct)}</td><td>{point.totalUsd == null ? "—" : money(Number(point.totalUsd))}</td></tr>)}</tbody></table></div><div className="chart-foot"><small>歷史週績效以各週最後可用收盤價估值；目前總資產另以最新持倉報價計算。TWD 依目前 USDTWD {fxRate ? fxRate.toFixed(4) : "待更新"} 換算。</small></div></> : <Empty text="至少需要連續兩週有效資產資料，才能計算週績效"/>}</article></>;
}

function CashLedger({ activities, accounts }: { activities: CashActivity[]; accounts: Dataset["accounts"] }) { const accountNames = Object.fromEntries(accounts.map((account) => [account.id, account.name])); return <section className="panel"><div className="panel-head"><div><h2>資金活動帳本</h2></div><span className="muted">不計入交易損益</span></div>{activities.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label="資料表，可捲動"><table className="cash-table"><thead><tr><th>日期</th><th>類型</th><th>帳戶</th><th>金額</th><th>狀態</th><th>來源／備註</th></tr></thead><tbody>{[...activities].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map((activity) => <tr key={activity.id}><td>{activity.timestamp.slice(0, 10)}</td><td>{activity.type === "DEPOSIT" ? "入金" : activity.type === "WITHDRAWAL" ? "提款" : activity.type === "FEE" ? "稅費" : activity.type}</td><td>{activity.accountId ? accountNames[activity.accountId] || activity.accountId : "待指定"}</td><td>{activity.currency ? money(activity.amount, activity.currency) : activity.amount.toLocaleString("zh-TW")}</td><td><span className={activity.requiresReview ? "status warn" : "status ok"}>{activity.requiresReview ? "待確認" : "已確認"}</span></td><td>{activity.note || activity.source || "本機資料"}</td></tr>)}</tbody></table></div> : <Empty text="尚無入金、出金或其他資金活動"/>}</section>; }
function WeeklyCyclePanel({ stats }: { stats: any[] }) { return <section className="panel weekly-cycle-panel"><div className="panel-head"><div><h2>每週閉環統計</h2></div><span className="muted">Asia／Taipei・週一至週日</span></div>{stats.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label="資料表，可捲動"><table><thead><tr><th>週期</th><th>樣本</th><th>平均報酬</th><th>獲利：虧損</th><th>獲利交易率</th><th>總盈虧（USD等值）</th></tr></thead><tbody>{stats.map((week) => <tr key={week.weekStart}><td>{week.weekStart} → {week.weekEnd}</td><td>{week.sampleCount}</td><td className={week.averageReturn == null ? "" : week.averageReturn >= 0 ? "positive" : "negative"}>{pct(week.averageReturn)}</td><td>{week.winners}：{week.losers}</td><td>{week.winRate == null ? "—" : `${(week.winRate * 100).toFixed(1)}%`}</td><td className={week.totalPnlUsd == null ? "" : week.totalPnlUsd >= 0 ? "positive" : "negative"}>{usdOrDash(week.totalPnlUsd)}</td></tr>)}</tbody></table></div> : <Empty text="目前沒有可分組的閉環樣本"/>}</section>; }

function OpenPositionDetail({ entryContexts, initialEventId, position, plan, marketBars, planHistory, strategies, strategyAssignments, onAssignStrategy, onStrategyCheck, onAddPlanVersion, onPlanChange, onPlanCommit, onOpenAnalysis, onClose }: { entryContexts: Record<string, any>; initialEventId?: string; position: any; plan: PositionPlan; marketBars: Record<string, unknown>[]; planHistory: PlanVersion[]; strategies: any[]; strategyAssignments: Record<string, any>; onAssignStrategy: (cycle: any, strategyId: string, source: string) => void; onStrategyCheck: (cycleId: string, phase: "pre" | "post", ruleId: string, status: string, note: string) => void; onAddPlanVersion: (version: PlanVersion) => void; onPlanChange: (position: any, field: PositionPlanField, value: string) => void; onPlanCommit: (position: any, field: PositionPlanField) => void; onOpenAnalysis: () => void; onClose: () => void }) {
  const openCycle = { ...position, status: "OPEN", averageEntry: position.averageCost, closeAt: new Date().toISOString() };
  return <DialogFrame className="detail-dialog" label={`${position.symbol} 持倉 K 線與交易計畫`} onClose={onClose}><article className="cycle-detail-modal"><div className="panel-head detail-header"><div><h2>{position.symbol} 持倉交易計畫 <span className={`direction ${position.direction.toLowerCase()}`}>{position.direction === "SHORT" ? "空" : "多"}</span><small className="block muted">持倉中・開倉日 {position.openAt.slice(0, 10)}</small></h2></div><div className="open-position-actions"><button type="button" className="ghost" onClick={onOpenAnalysis}>查看交易行為分析</button><button type="button" className="close" aria-label="關閉視窗" onClick={onClose}>×</button></div></div><SectionLinks label="持倉詳情區段" links={[{id:"position-replay",label:"K 線與事件"},{id:"position-plan",label:"目前計畫"}]}/><div id="position-replay" tabIndex={-1}><ReplayBoard initialEventId={initialEventId} cycle={openCycle} marketBars={marketBars} planHistory={planHistory} review={{}} rapidPairs={[]} decisionLinks={{}} strategies={strategies} strategyAssignments={strategyAssignments} entryContexts={entryContexts} openPlan={plan} onAddPlanVersion={onAddPlanVersion}/></div><EntryContextEvidence contexts={entryContexts} cycleId={position.id}/><StrategyChecklist cycle={position} strategies={strategies} assignment={strategyAssignments[position.id]} phase="pre" onAssign={onAssignStrategy} onCheck={onStrategyCheck}/><section className="cycle-detail-section" id="position-plan" tabIndex={-1}><div className="panel-head"><div><h3>目前計畫</h3><small className="muted">此處與「目前持倉」表格同步，並將計畫保存為可追溯版本。</small></div></div><div className="cycle-review-form open-plan-form"><label>停損價<input type="number" min="0" step="any" value={plan.stopLoss ?? ""} placeholder="未設定" onChange={(event) => onPlanChange(position, "stopLoss", event.target.value)} onBlur={() => onPlanCommit(position, "stopLoss")}/></label><label>停利價<input type="number" min="0" step="any" value={plan.takeProfit ?? ""} placeholder="未設定" onChange={(event) => onPlanChange(position, "takeProfit", event.target.value)} onBlur={() => onPlanCommit(position, "takeProfit")}/></label><label>計畫與失效條件<textarea value={plan.note || ""} placeholder="例：跌破支撐且收盤無法站回" onChange={(event) => onPlanChange(position, "note", event.target.value)} onBlur={() => onPlanCommit(position, "note")}/></label></div></section></article></DialogFrame>;
}

function CycleDetail({ entryContexts, cycle, marketBars, review, planHistory, rapidPairs, cycles, decisionLinks, decisionLinkHistory, strategies, strategyAssignments, onAssignStrategy, onStrategyCheck, onAddPlanVersion, onReviewChange, onToggleDecisionLink, onClose }: { entryContexts: Record<string, any>; cycle: any; marketBars: Record<string, unknown>[]; review: CycleReview; planHistory: PlanVersion[]; rapidPairs: any[]; cycles: any[]; decisionLinks: Record<string, DecisionLink>; decisionLinkHistory: DecisionLinkEvent[]; strategies: any[]; strategyAssignments: Record<string, any>; onAssignStrategy: (cycle: any, strategyId: string, source: string) => void; onStrategyCheck: (cycleId: string, phase: "pre" | "post", ruleId: string, status: string, note: string) => void; onAddPlanVersion: (version: PlanVersion) => void; onReviewChange: (cycleId: string, field: CycleReviewField, value: string) => void; onToggleDecisionLink: (pairKey: string) => void; onClose: () => void }) {
  const analysis = analyzeCycle(cycle, marketBars, review);
  const relatedPairs = rapidPairs.filter((pair) => pair.previousCycleId === cycle.id || pair.nextCycleId === cycle.id);
  const cycleNames = Object.fromEntries(cycles.map((item) => [item.id, `${item.symbol} ${item.openAt.slice(0, 10)}→${item.closeAt.slice(0, 10)}`]));
  return <DialogFrame className="detail-dialog" label={`${cycle.symbol} 交易閉環詳情`} onClose={onClose}><article className="cycle-detail-modal"><div className="panel-head detail-header"><div><h2>{cycle.symbol} 交易閉環詳情 <span className={`direction ${cycle.direction.toLowerCase()}`}>{cycle.direction === "SHORT" ? "空" : "多"}</span></h2></div><button type="button" className="close" aria-label="關閉視窗" onClick={onClose}>×</button></div>{analysis.sameDay && <div className="precision-warning"><b>同日交易・日線近似</b><span>MAE／MFE不可視為分鐘級正式結果。</span></div>}<SectionLinks label="閉環詳情區段" links={[{id:"cycle-replay",label:"K 線與事件"},{id:"cycle-quality",label:"人工評分"},{id:"cycle-evidence",label:"成交證據"},{id:"cycle-reflection",label:"計畫與復盤"}]}/><div id="cycle-replay" tabIndex={-1}><ReplayBoard cycle={cycle} marketBars={marketBars} planHistory={planHistory} review={review} rapidPairs={rapidPairs} decisionLinks={decisionLinks} strategies={strategies} strategyAssignments={strategyAssignments} entryContexts={entryContexts} onAddPlanVersion={onAddPlanVersion}/></div><EntryContextEvidence contexts={entryContexts} cycleId={cycle.id}/><StrategyChecklist cycle={cycle} strategies={strategies} assignment={strategyAssignments[cycle.id]} phase="post" onAssign={onAssignStrategy} onCheck={onStrategyCheck}/><div className="cycle-detail-metrics"><div><span>損益／報酬</span><b className={cycle.pnl >= 0 ? "positive" : "negative"}>{money(cycle.pnl, cycle.currency)}</b><small>{pct(cycle.returnPct)}</small></div><div><span>持有時間</span><b>{analysis.holdingHours.toFixed(1)} 小時</b><small>{analysis.tradingDays == null ? "交易日待行情" : `${analysis.tradingDays} 個交易日`}</small></div><div><span>MAE／MFE</span><b>{pct(cycle.maePct)}／{pct(cycle.mfePct)}</b><small>{analysis.precision}</small></div><div><span>MFE留存率</span><b>{pct(analysis.mfeRetention)}</b><small>最大回吐 {pct(analysis.maxGiveback)}</small></div><div><span>R倍數</span><b>{analysis.rMultiple == null ? "—" : `${analysis.rMultiple.toFixed(2)}R`}</b><small>{analysis.initialRisk == null ? "需先填事前停損" : `原始風險 ${money(analysis.initialRisk, cycle.currency)}`}</small></div><div><span>停損延遲成本</span><b className={analysis.stopDelayCost ? "negative" : ""}>{analysis.stopDelayCost == null ? "—" : money(analysis.stopDelayCost, cycle.currency)}</b><small>只依事前停損計算</small></div><div><span>規則修改成本</span><b className={analysis.ruleModificationCost ? "negative" : ""}>{analysis.ruleModificationCost == null ? "—" : money(analysis.ruleModificationCost, cycle.currency)}</b><small>修訂停損增加的風險</small></div></div><section className="cycle-detail-section" id="cycle-evidence" tabIndex={-1}><h3>成交鏈與成本批次</h3><div className="table-wrap" tabIndex={0} role="region" aria-label="資料表，可捲動"><table><thead><tr><th>時間</th><th>方向</th><th>數量</th><th>成交價</th><th>費用</th></tr></thead><tbody>{cycle.fills.map((fill: Fill) => <tr key={fill.id}><td>{localDateTime(fill.timestamp)}</td><td>{fill.side === "BUY" ? "買進" : "賣出"}</td><td>{fill.quantity}</td><td>{money(fill.price, fill.currency)}</td><td>{money(fill.fee || 0, fill.currency)}</td></tr>)}</tbody></table></div><small className="section-note">FIFO成本；平均進場 {money(cycle.averageEntry, cycle.currency)}，平均出場 {money(cycle.averageExit, cycle.currency)}。</small></section><section className="cycle-detail-section"><h3>出場後表現</h3><div className="post-exit-grid">{Object.entries(analysis.postExitReturns).map(([day, value]) => <div key={day}><span>第 {day} 個交易日</span><b className={value == null ? "" : Number(value) >= 0 ? "positive" : "negative"}>{value == null ? "—" : pct(Number(value))}</b></div>)}</div><small className="section-note">正值代表若延後出場，原交易方向仍有額外報酬；缺行情時不推算。</small></section><section className="cycle-detail-section" id="cycle-quality" tabIndex={-1}><h3>交易品質標籤與進出場回顧</h3><div className="cycle-quality-pickers"><QualityTagPicker cycle={cycle} kind="entry" value={review.entryQualityTag} onChange={(value) => onReviewChange(cycle.id, "entryQualityTag", value)}/><QualityTagPicker cycle={cycle} kind="exit" value={review.exitQualityTag} onChange={(value) => onReviewChange(cycle.id, "exitQualityTag", value)}/></div><div className="cycle-review-form trade-point-review"><label>進場點回顧<textarea value={review.entryReview || ""} placeholder="當時為何在這裡進場？是否追價？若重做會等哪個價位或訊號？" onChange={(event) => onReviewChange(cycle.id, "entryReview", event.target.value)}/></label><label>出場點回顧<textarea value={review.exitReview || ""} placeholder="當時為何在這裡出場？是否過早或過晚？若重做會在哪裡賣？" onChange={(event) => onReviewChange(cycle.id, "exitReview", event.target.value)}/></label></div><small className="section-note">標籤選擇後即同步分布並背景儲存；文字欄補充 K 線、原計畫及改善證據。最後評分：{localDateTime(review.qualityRatedAt)}。</small></section><section className="cycle-detail-section" id="cycle-reflection" tabIndex={-1}><h3>事前計畫與其他復盤</h3><div className="cycle-review-form"><label>事前計畫<textarea value={review.preTradePlan || ""} onChange={(event) => onReviewChange(cycle.id, "preTradePlan", event.target.value)}/></label><label>失效條件<textarea value={review.invalidation || ""} onChange={(event) => onReviewChange(cycle.id, "invalidation", event.target.value)}/></label><label>出場理由<textarea value={review.exitReason || ""} onChange={(event) => onReviewChange(cycle.id, "exitReason", event.target.value)}/></label><label>事後反省<textarea value={review.reflection || ""} onChange={(event) => onReviewChange(cycle.id, "reflection", event.target.value)}/></label><label>行為／策略標籤<input value={review.tags || ""} placeholder="例：突破、追價、停損延遲" onChange={(event) => onReviewChange(cycle.id, "tags", event.target.value)}/></label><label>事前停損價格<input type="number" min="0" step="any" value={review.plannedStop ?? ""} placeholder="未設定則不計算R" onChange={(event) => onReviewChange(cycle.id, "plannedStop", event.target.value)}/></label><label>修訂停損價格<input type="number" min="0" step="any" value={review.revisedStop ?? ""} placeholder="用於計算規則修改成本" onChange={(event) => onReviewChange(cycle.id, "revisedStop", event.target.value)}/></label></div><small className="section-note">最後更新：{localDateTime(review.updatedAt)}；內容依帳號自動儲存，並可匯出 JSON 備份。</small></section><section className="cycle-detail-section"><h3>快速買回與決策鏈</h3>{relatedPairs.length ? <div className="decision-pairs">{relatedPairs.map((pair) => { const pairKey = `${pair.previousCycleId}>${pair.nextCycleId}`; const linked = Boolean(decisionLinks[pairKey]?.linked); const versions = decisionLinkHistory.filter((event) => event.pairKey === pairKey).length; return <div key={pairKey}><div><b>{cycleNames[pair.previousCycleId]} ↔ {cycleNames[pair.nextCycleId]}</b><small>{pair.gapTradingDays} 個交易日內重新建倉・{versions} 次版本修改</small></div><button type="button" className={linked ? "ghost" : "primary"} onClick={() => onToggleDecisionLink(pairKey)}>{linked ? "解除決策鏈" : "連結為決策鏈"}</button></div>; })}</div> : <Empty text="3個交易日內沒有同帳戶、同標的快速買回"/>}<small className="section-note">連結只建立決策關係，不刪除或覆蓋原始閉環；每次修改均保留時間版本。</small></section></article></DialogFrame>;
}

function CycleTable({ cycles, title, embedded = false, historyState, onRefresh, onSelect }: { cycles: any[]; title: string; embedded?: boolean; historyState?: string; onRefresh?: () => void; onSelect?: (cycle: any) => void }) { return <section className="panel"><div className="panel-head"><div>{embedded ? <h3>{title}</h3> : <h2>{title}</h2>}</div>{onRefresh ? <div className="cycle-actions"><span className="muted">{historyState}</span><button className="ghost" type="button" onClick={onRefresh}>更新閉環行情</button></div> : <span className="muted">FIFO・多空雙向・日曆日</span>}</div>{cycles.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label="資料表，可捲動"><table className="cycles-table"><thead><tr><th>標的</th><th>方向</th><th>期間</th><th>進場價</th><th>出場價</th><th>持倉</th><th>損益</th><th>報酬</th><th>MAE</th><th>MFE</th><th>行情</th><th>操作</th></tr></thead><tbody>{cycles.map((cycle) => <tr key={cycle.id}><td><b>{cycle.symbol}</b></td><td><span className={`direction ${cycle.direction.toLowerCase()}`}>{cycle.direction === "SHORT" ? "空" : "多"}</span></td><td>{cycle.openAt.slice(0, 10)} → {cycle.closeAt.slice(0, 10)}</td><td>{money(cycle.averageEntry, cycle.currency)}</td><td>{money(cycle.averageExit, cycle.currency)}</td><td>{cycle.holdingDays} 天</td><td className={cycle.pnl >= 0 ? "positive" : "negative"}>{money(cycle.pnl, cycle.currency)}</td><td>{pct(cycle.returnPct)}</td><td>{pct(cycle.maePct)}</td><td>{pct(cycle.mfePct)}</td><td><span className={cycle.quality === "完整" ? "status ok" : "status warn"}>{cycle.quality}</span></td><td><button className="text-button" type="button" aria-label={`查看 ${cycle.symbol} ${cycle.closeAt.slice(0, 10)} 交易閉環詳情`} onClick={() => onSelect?.(cycle)}>詳情</button></td></tr>)}</tbody></table></div> : <Empty text="尚未形成完整交易閉環"/>}</section>; }
function QuoteRefreshStatus({ lastQuoteAt }: { lastQuoteAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const nextRefresh = lastQuoteAt == null ? 0 : Math.max(0, Math.ceil((QUOTE_REFRESH_MS - (now - lastQuoteAt)) / 1000));
  return <div><b>{lastQuoteAt ? new Date(lastQuoteAt).toLocaleTimeString("zh-TW") : "—"}</b><small>{lastQuoteAt ? `${nextRefresh} 秒後背景更新` : "正在背景取得報價"}</small></div>;
}
function Empty({ text }: { text: string }) { return <div className="empty"><span>○</span><p>{text}</p></div>; }
