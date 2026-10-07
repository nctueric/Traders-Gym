/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FitNumber, MobileDetails } from "./mobile-ui";
import { ProductOnboarding } from "./product-onboarding";
import { CashLedger,CashEditor } from './cash-ledger';
import { WorkspaceNavigation } from './workspace-navigation';
import { LedgerManager } from './ledger-manager';
import { useDemoRuntime } from './demo-context';
import {useWorkspaceClock} from './workspace-clock';
import { updateCashActivity } from '@/lib/cash-activities.mjs';

import {sortCycleRows} from "@/lib/cycle-table-sort.mjs";
import {OpenPositionDetail} from './open-position-detail';
import {commitPositionPlanEdit} from '@/lib/position-plan-edit.mjs';
import {PerformancePreload} from "./performance-preload";
import {memoryPerformanceCache,createPerformanceHistoryResource} from "@/lib/performance-cache.mjs";
import { PerformanceWorkspace } from "./performance-workspace";
import { InfoPopover, InfoPopoverGroup } from "./info-popover";
import { MonthReturnComparison } from "./month-return-comparison";
import { normalizeHoldingsColorScheme } from "@/lib/holdings-heatmap.mjs";
import { HoldingsHeatmap } from "./holdings-heatmap";
import { monthlyReturnSignal } from "@/lib/ytd-return.mjs";
import { positionDayChange } from "@/lib/position-day-change.mjs";
import { missingHistoryRanges, mergeHistoryCoverage } from "@/lib/history-coverage.mjs";
import { emaWarmupStart } from "@/lib/chart-indicators.mjs";
import { TradeRegistration, CycleRebuildHistory } from "./simple-entry-workspace";
import {createSimpleDraft,commitSimpleBatch,simpleTimeLabel} from "@/lib/simple-entry.mjs";
import { createEntryDraft, commitEntry } from "@/lib/trade-entry.mjs";
import { WorkspacePreferences,useWorkspacePreferences } from "./workspace-preferences";
import {ValuationProvider,ValuationControl,useValuation} from "./valuation-context";
import {cycleValue,currencyTotal,formatCurrency} from "@/lib/valuation.mjs";
import {periodValuation,realizedValue,cycleGroupValuation} from "@/lib/valuation-reports.mjs";
import {LegacyRecords} from "./legacy-records";
import { Fragment, startTransition, useCallback, useEffect, useMemo, useRef, useState,useSyncExternalStore } from "react";
import { runSelfTests, summarize } from "@/lib/trade-engine.mjs";
import { isQuoteStale, mergeMarketBars, QUOTE_REFRESH_MS, toProviderSymbol, USDTWD_SYMBOL } from "@/lib/quote-engine.mjs";
import { classifyCashActivities, importTradingViewCsv, preserveExistingCashOnFillImport } from "@/lib/trader-x2-importer.mjs";
import { buildCurrentEquity, buildPositionMetrics, cycleRangeScore, positionPortfolioImpactPct } from "@/lib/portfolio-engine.mjs";
import { findRapidRepurchases, weeklyCycleStats } from "@/lib/review-engine.mjs";
import { completeTradeJson, DEFAULT_RECORD_ACCOUNT_ID, durableTradeJson } from "@/lib/trade-record-store.mjs";
import { buildTradeSnapshot, mergeSnapshotEvidence, restoreMarketSnapshot } from "@/lib/trade-snapshot.mjs";
import { canRefreshCloudRecord, createRecordSaveQueue, saveTradeRecord } from "@/lib/trade-record-client.mjs";
import { serializeInBackground } from "@/lib/background-serializer.mjs";
import { buildCoachFindings, createExperimentFromFinding, detectBehaviorEvents, evaluateExperiment, openPositionWindowDates, replayWindowDates } from "@/lib/coach-engine.mjs";
import { buildCoachBrief } from "@/lib/coach-brief.mjs";
import { createStrategyAssignment, normalizeStrategyDataset, updateStrategyCheck, updateStrategyStageReview } from "@/lib/strategy-engine.mjs";
import { TrainingWorkspace } from "./training-workspace";
import { StrategyWorkspace } from "./strategy-workspace";
import { updateQualityRating } from "@/lib/quality-rating.mjs";
import { DialogFrame, OverviewDisclosure } from "./workspace-ui";
import { PositionTransactions } from "./position-transactions";
import { EquityBreakdown } from "./equity-breakdown";
import {MonthlyValuation} from "./monthly-valuation";
import { TodayWorkspace } from "./today-workspace";
import { CycleReviewDialog } from "./cycle-review-dialog";
import type { AccountUser } from "./account-server";
import { createSessionScope } from "@/lib/account-client.mjs";

type Fill = { id: string; accountId: string; symbol: string; market: string; currency: string; side: "BUY" | "SELL"; quantity: number; price: number; fee: number; timestamp: string; note?: string };
type CashActivity = { id: string; type: string; amount: number; timestamp: string; accountId: string | null; currency: string | null; requiresReview?: boolean; source?: string; note?: string };
type PositionPlan = { source?: string; takeProfit?: number | null; stopLoss?: number | null; note?: string; updatedAt?: string };
type CycleReview = { preTradePlan?: string; invalidation?: string; entryReview?: string; exitReason?: string; exitReview?: string; reflection?: string; tags?: string; plannedStop?: number | null; revisedStop?: number | null; entryQualityTag?: "EARLY" | "LATE" | "IDEAL" | "WRONG_ENTRY" | null; exitQualityTag?: "EARLY" | "LATE" | "IDEAL" | null; qualityRatedAt?: string; updatedAt?: string };
type CycleReviewField = "preTradePlan" | "invalidation" | "entryReview" | "exitReason" | "exitReview" | "reflection" | "tags" | "plannedStop" | "revisedStop" | "entryQualityTag" | "exitQualityTag";
type DecisionLink = { linked: boolean; updatedAt: string };
type DecisionLinkEvent = { pairKey: string; linked: boolean; updatedAt: string };
type PlanVersion = { id: string; cycleId?: string; accountId: string; symbol: string; field: "stopLoss" | "takeProfit" | "invalidation"; value: number | string | null; reason?: string; effectiveAt?: string | null; createdAt: string; source?: string };
type ImprovementExperiment = { id: string; findingType: string; title: string; trigger: string; action: string; metric: string; target: string; startDate: string; endDate: string; status: "ACTIVE" | "COMPLETED"; baseline?: { sampleCount: number; violationCount: number; impactUsd: number }; evidenceCycleIds?: string[]; createdAt: string; updatedAt?: string; resultNote?: string };
type Dataset = { demoWarnings?: string[]; simpleEntryDraft?: any; entryDraft?: any; entryContexts?: Record<string, any>; marketSnapshot?: any; version: string; profile: { name: string; baseCurrency: string; costMethod: string }; accounts: { id: string; name: string; currency: string }[]; fills: Fill[]; cashActivities?: CashActivity[]; marketBars: Record<string, unknown>[]; settings: { quoteProvider: string; benchmarkSymbol?: string; holdingsColorScheme?: "green-up" | "red-up" }; positionPlans?: Record<string, PositionPlan>; cycleReviews?: Record<string, CycleReview>; decisionLinks?: Record<string, DecisionLink>; decisionLinkHistory?: DecisionLinkEvent[]; planHistory?: PlanVersion[]; improvementExperiments?: ImprovementExperiment[]; strategies?: any[]; strategyAssignments?: Record<string, any>; source?: { fileName?: string; format?: string } };
type Quote = { symbol: string; price: number; previousClose: number | null; changePct: number | null; currency: string; marketState: string; updatedAt: string | null; source: string };
type HistoryBar = { symbol: string; date: string; close: number; open?: number; high?: number; low?: number; volume?: number | null };
type PendingImport = { dataset: Dataset; fileName: string; kind: "JSON" | "TradingView CSV"; duplicateCount: number; warnings: string[] };
type RecordAccount = { id: string; name: string; version: number; updatedAt: string };

const emptyData: Dataset = { version: "0.1.0", profile: { name: "我的交易帳本", baseCurrency: "USD", costMethod: "FIFO" }, accounts: [{ id: "main", name: "主要帳戶", currency: "USD" }], fills: [], cashActivities: [], marketBars: [], settings: { quoteProvider: "json", benchmarkSymbol: "SPY" }, positionPlans: {}, cycleReviews: {}, decisionLinks: {}, decisionLinkHistory: [], planHistory: [], improvementExperiments: [], strategies: [], strategyAssignments: {} };
function pct(value: number | null) { return value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`; }
function money(value: number, currency = "USD") { return new Intl.NumberFormat("zh-TW", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2 }).format(value); }
function localDateTime(value?: string | null) { return value ? new Date(value).toLocaleString("zh-TW", { hour12: false }) : "尚未設定"; }
function addCurrencyValues(...groups: Record<string, number>[]) { return groups.reduce<Record<string, number>>((result, group) => { Object.entries(group).forEach(([currency, value]) => { result[currency] = (result[currency] || 0) + value; }); return result; }, {}); }
function currentMonthKey(now = new Date()) { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).formatToParts(now); return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`; }
function cycleHistoryTargets(cycles: any[], positions: any[]) {
  const grouped = new Map<string, { symbol: string; market: string; start: string; end: string }>();
  for (const item of [...cycles.map((cycle) => ({ item: cycle, range: replayWindowDates(cycle) })), ...positions.map((position) => ({ item: position, range: openPositionWindowDates(position) }))]) {
    const key = `${item.item.market || ""}:${item.item.symbol}`;
    const { end } = item.range;
    const start = emaWarmupStart(item.range.start);
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
function fetchHistoryInBackground(url: string, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const run = async () => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetcher(url, { signal });
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

export default function TradeWorkspace(props: { user: AccountUser; requestedAccountId?:string;initialRecord?:any;initialPreferences?:any;loadingFallback?:React.ReactNode }) {
 const demo=useDemoRuntime();const fetcher=useMemo(()=>createSessionScope(props.user.sessionId,demo?.fetcher||fetch).fetch,[props.user.sessionId,demo]);
 return <WorkspacePreferences userId={props.user.id} demo={demo} fetcher={fetcher} initialBootstrap={props.initialPreferences} legacyColor={props.initialRecord?.dataset?.settings?.holdingsColorScheme}><TradeWorkspaceContent {...props}/></WorkspacePreferences>;
}
export function TradeWorkspaceContent({ user, requestedAccountId, initialRecord, loadingFallback }: { user: AccountUser; requestedAccountId?:string;initialRecord?:any;loadingFallback?:React.ReactNode }) {
  const demo=useDemoRuntime();
  const workspaceNow=useWorkspaceClock();
  const sessionScope = useMemo(() => createSessionScope(user.sessionId, demo?.fetcher || fetch), [user.sessionId,demo]);
  const {preferences,configured,ready:preferencesReady,update: updatePreferences}=useWorkspacePreferences();
  const valuationCurrency=preferences.valuationCurrency;
  const [online,setOnline]=useState(true);
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);update();window.addEventListener("online",update);window.addEventListener("offline",update);return()=>{window.removeEventListener("online",update);window.removeEventListener("offline",update);};},[]);
  const [noLedger,setNoLedger]=useState(false);
  const [cashEditor,setCashEditor]=useState<CashActivity|null|undefined>(undefined);

  const [sessionEnded, setSessionEnded] = useState(false);
  const sessionInvalidatedRef = useRef(false);
  const [data, setDataInternal] = useState<Dataset>(emptyData);
  const setData=useCallback((next:React.SetStateAction<Dataset>)=>{if(!demo&&typeof navigator!=='undefined'&&navigator.onLine===false)return;setDataInternal(next);},[demo]);
  const [storageReady, setStorageReady] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const colorMigrated=useRef(false);
  useEffect(()=>{const color=data.settings?.holdingsColorScheme;if(!demo&&storageReady&&preferencesReady&&!colorMigrated.current&&!configured?.includes("holdingsColorScheme")&&["green-up","red-up"].includes(color||"")){colorMigrated.current=true;void updatePreferences({holdingsColorScheme:color}).catch(()=>{colorMigrated.current=false;});}},[data.settings?.holdingsColorScheme,demo,storageReady,preferencesReady,configured,updatePreferences]);
  useEffect(()=>{if(storageReady&&cloudReady&&!demo){performance.mark("tg-full-ledger-ready");if(document.documentElement){document.documentElement.dataset.tgFullLedgerReady=String(performance.now());document.documentElement.dataset.tgRecordDownloads=String(performance.getEntriesByType("resource").filter(e=>new URL(e.name,location.href).pathname==="/api/trade-records").length);}}},[storageReady,cloudReady,demo]);
  const [recordAccounts, setRecordAccounts] = useState<RecordAccount[]>([]);
  const [activeRecordAccountId, setActiveRecordAccountId] = useState(DEFAULT_RECORD_ACCOUNT_ID);
  const performanceResource = useMemo(()=>createPerformanceHistoryResource({
    storage:memoryPerformanceCache(`${user.id}:${activeRecordAccountId}:${demo?"demo":"member"}`),
    fetcher:sessionScope.fetch,
  }),[user.id,activeRecordAccountId,demo,sessionScope]);
  const [saveState, setSaveState] = useState("正在載入交易帳號…");
  const [tab, setTab] = useState("overview");
  const [navOpen, setNavOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [ledgerTab, setLedgerTab] = useState("fills");
  const strategyDirtyRef = useRef(false);
  const changePage = (nextTab: string) => { if(nextTab!==tab&&strategyDirtyRef.current&&!window.confirm('策略尚有未儲存修改，確定離開？')) return; setTab(nextTab); setNavOpen(false); document.getElementById("workspace-main")?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "instant" }); };
  const [message, setMessage] = useState("正在載入雲端帳本；可匯入 JSON 或 TradingView CSV。");
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [cashCurrency, setCashCurrency] = useState("USD");
  const benchmarkSymbol = data.settings?.benchmarkSymbol || "SPY";
  const [benchmarkBars, setBenchmarkBars] = useState<HistoryBar[]>([]);
  const [benchmarkDataSymbol, setBenchmarkDataSymbol] = useState(benchmarkSymbol);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [quoteState, setQuoteState] = useState("準備更新");
  const [lastQuoteAt, setLastQuoteAt] = useState<number | null>(null);
  const [manualSaving, setManualSaving] = useState(false);
  const manualSavingRef = useRef(false);
  const [, setBenchmarkState] = useState("準備讀取 ETF 歷史行情");
  const [cycleHistoryState, setCycleHistoryState] = useState("準備同步閉環日線");
  const [cycleHistoryRefresh, setCycleHistoryRefresh] = useState(0);
  const historyRefreshUsed = useRef(0);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [positionEventId, setPositionEventId] = useState<string | undefined>();
  const openPositionChart = useCallback((position: { id: string }, eventId?: string) => {
    setPositionEventId(eventId);
    setSelectedPositionId(position.id);
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
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
    setDataInternal(normalizeStrategyDataset(incoming) as Dataset);
    setQuotes(restored.quotes);
    setLastQuoteAt(restored.lastQuoteAt);
    setBenchmarkDataSymbol(restored.benchmarkSymbol);
    setBenchmarkBars(restored.benchmarkBars);
    setQuoteState(Object.keys(restored.quotes).length ? "已還原儲存行情，正在背景更新" : "備份沒有報價快照，正在取得行情");
  }, []);

  useEffect(() => {
    let active = true;
    sessionScope.activate();
    const restore = async () => {
      try {
        let payload=initialRecord;
        if(!payload){
        const response = await sessionScope.fetch(`/api/trade-records${requestedAccountId ? `?accountId=${encodeURIComponent(requestedAccountId)}` : ''}`, { cache: "no-store" });
        payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "帳本讀取失敗");
        }
        if (!active) return;
        if(!payload.account){setNoLedger(true);setRecordAccounts([]);setStorageReady(true);setCloudReady(true);setSaveState('尚無帳本');return;}
        setNoLedger(false);
        loadDataset(payload.dataset);
        setStorageConflict(false);
        lastSavedSnapshotRef.current=payload.dataset;
        setRecordAccounts(payload.accounts || [payload.account]);
        setActiveRecordAccountId(payload.account.id);
        recordVersionRef.current = payload.account.version;
        lastSavedJsonRef.current = completeTradeJson(normalizeStrategyDataset(payload.dataset));
        setSaveState(`已載入雲端紀錄・${localDateTime(payload.account.updatedAt)}・v${payload.account.version}`);
        setMessage(demo?"已載入示範交易；真實市場資料可能延遲。":"已載入你的交易帳本。");
        setCloudReady(true);
        setStorageReady(true);
      } catch (error) {
        if (!active) return;
        setCloudReady(false);
        setSaveState(`帳本載入失敗：${error instanceof Error ? error.message : "請重新整理後重試"}`);
        if ([401, 403].includes((error as any)?.status)) setSessionEnded(true);
      }
    };
    void restore();
    return () => { active = false; sessionScope.stop(); };
  }, [loadDataset, sessionScope,requestedAccountId,demo,initialRecord]);

  const persistCompleteSnapshot = useCallback((force = false, label = "自動") => saveQueueRef.current(async () => {
    if(demo){demo.update(latestSaveRef.current.dataset);setSaveState('當次練習已更新・離開後重置');return;}
    if(noLedger)return;
    sessionScope.assertActive();
    if (storageConflict) throw Object.assign(new Error("尚有版本衝突，請先匯出備份並確認版本"), { status: 409, retryable: false });
    const captured = latestSaveRef.current;
    if (captured.accountId !== activeRecordAccountId) return;
    const serialized = await serializeInBackground(captured.dataset);
    sessionScope.assertActive();
    if (latestSaveRef.current.accountId !== captured.accountId) return;
    if(!navigator.onLine)throw new Error("目前離線，尚未儲存；當頁修改仍保留，可匯出或稍後重試");
    if (!force && serialized === lastSavedJsonRef.current && recordVersionRef.current != null) {
      lastSavedSnapshotRef.current = captured.dataset;
      return;
    }
    setSaveState(`正在${label}儲存至雲端…`);
    const saved = await saveTradeRecord({ accountId: captured.accountId, accountName: activeRecordAccountName, serialized, baseVersion: recordVersionRef.current, baselineJson: lastSavedJsonRef.current, saveMode: force ? "manual" : "auto", fetcher: sessionScope.fetch });
    sessionScope.assertActive();
    if (latestSaveRef.current.accountId !== captured.accountId) return;
    if (saved.dataset && durableDatasetJson(saved.dataset) !== captured.serialized && latestSaveRef.current.serialized !== captured.serialized) {
      throw Object.assign(new Error("同步期間又有當頁修改；已停止覆寫，請先匯出備份再確認版本"), { status: 409, retryable: false });
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
    setRecordAccounts(current => [saved.account, ...current.filter(account => account.id !== saved.account.id)]);
    const newerEdits = pending.dataset !== captured.dataset && !saved.dataset;
    setSaveState(`雲端已儲存（${label}）・${new Date(saved.account.updatedAt).toLocaleTimeString("zh-TW", { hour12: false })}・v${saved.account.version}${newerEdits ? "；較新資料待背景儲存" : ""}`);
    return saved;
  }), [activeRecordAccountId, activeRecordAccountName, loadDataset, storageConflict, sessionScope,demo,noLedger]);

  const handleSaveError = useCallback((error: any) => {
    if (sessionInvalidatedRef.current) return;
    if ([401, 403].includes(error?.status)) {
      sessionInvalidatedRef.current = true;
      sessionScope.stop();setSessionEnded(true);setCloudReady(false);clearTimeout(retryTimerRef.current); return;
    }
    if(error?.status===410){setCloudReady(false);setStorageConflict(true);clearTimeout(retryTimerRef.current);setSaveState('帳本已移至回收筒，已停止背景同步。請管理帳本以還原或切換。');return;}
    const retryable = error?.retryable !== false;
    if (error?.status === 409) setStorageConflict(true);
    const delay = Math.min(30_000, 5_000 * 2 ** retryCountRef.current++);
    setSaveState(`${retryable ? "等待重試" : "儲存失敗"}：${error instanceof Error ? error.message : "未知錯誤"}；修改只保留於當頁，請勿重整，可匯出 JSON${retryable ? `；${delay / 1000} 秒後重試` : ""}`);
    clearTimeout(retryTimerRef.current);
    if (retryable) retryTimerRef.current = setTimeout(() => setSaveRetry(current => current + 1), delay);
  }, [sessionScope]);

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

  const backgroundSaveRef = useRef(() => {});
  useEffect(() => { backgroundSaveRef.current = () => { void persistCompleteSnapshot().catch(handleSaveError); }; }, [persistCompleteSnapshot, handleSaveError]);
  useEffect(() => {
    if(!storageReady||!cloudReady||storageConflict||noLedger||(!demo&&!online))return;
    const timer=setTimeout(()=>backgroundSaveRef.current(),1000);return()=>clearTimeout(timer);
  },[durableJson,storageReady,cloudReady,storageConflict,noLedger,demo,online]);
  useEffect(()=>{if(!demo&&storageReady&&cloudReady&&online&&!storageConflict){const timer=window.setInterval(()=>backgroundSaveRef.current(),60_000);return()=>window.clearInterval(timer);}},[demo,storageReady,cloudReady,online,storageConflict]);
  useEffect(()=>{if(saveRetry&&storageReady&&cloudReady&&!storageConflict&&online)backgroundSaveRef.current();},[saveRetry,storageReady,cloudReady,storageConflict,online]);
  useEffect(()=>{if(!demo&&!noLedger&&storageReady)setOnboardingOpen(!preferences.onboardingDone);},[demo,noLedger,storageReady,preferences.onboardingDone]);
  useEffect(() => () => clearTimeout(retryTimerRef.current), []);

  useEffect(() => {
    if(demo)return;
    const retry = () => setSaveRetry(current => current + 1);
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(!canRefreshCloudRecord(latestSaveRef.current.serialized,lastSavedJsonRef.current)){event.preventDefault();event.returnValue="";}};
    window.addEventListener("online",retry);window.addEventListener("beforeunload",beforeUnload);
    return()=>{window.removeEventListener("online",retry);window.removeEventListener("beforeunload",beforeUnload);};
  },[demo]);
  useEffect(() => {
    if(demo)return;
    let active = true;
    const verify = async () => {
      try {
        const response = await sessionScope.fetch("/api/auth/session", { cache: "no-store" });
        if (response.ok) { const payload = await response.json(); if (payload.user?.sessionId !== user.sessionId) throw Object.assign(new Error("帳號已變更"), { status: 401 }); }
      } catch (error) { if (active && [401, 403].includes((error as any)?.status)) handleSaveError(error); }
    };
    const timer = window.setInterval(() => void verify(), 30_000);
    const expiry = window.setTimeout(() => { if (Date.now() >= Date.parse(user.expiresAt)) handleSaveError({ status: 401 }); else void verify(); }, Math.max(0, Math.min(2_147_000_000, Date.parse(user.expiresAt) - Date.now())));
    const focus = () => { void verify(); };
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", focus);
    return () => { active=false;window.clearInterval(timer);window.clearTimeout(expiry);window.removeEventListener("focus",focus);window.removeEventListener("pageshow",focus); };
  }, [sessionScope, handleSaveError, user.sessionId, user.expiresAt,demo]);
  // Returning mobile tabs may retain the whole page for days. Revalidate the
  // ledger as well as the session, without replacing unsynced work.
  useEffect(() => {
    if (demo || noLedger || !storageReady || !cloudReady || storageConflict) return;
    let active = true, checking = false;
    const editing = () => strategyDirtyRef.current || Boolean(document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'));
    const refresh = () => {
      if (document.visibilityState !== "visible" || checking || editing()) return;
      checking = true;
      void saveQueueRef.current(async () => {
        if (!active || editing()) return;
        const captured = latestSaveRef.current;
        const indexResponse = await sessionScope.fetch("/api/ledgers", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (!indexResponse.ok) throw Object.assign(new Error("無法確認雲端最新版本"), { status: indexResponse.status });
        const index = await indexResponse.json();
        if (!active) return;
        const remote = index.accounts?.find((account: any) => account.id === captured.accountId);
        if (!remote || remote.deletedAt) throw Object.assign(new Error("帳本已移除或無法存取"), { status: 410 });
        if (remote.version <= (recordVersionRef.current ?? 0)) return;
        const response = await sessionScope.fetch(`/api/trade-records?accountId=${encodeURIComponent(captured.accountId)}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw Object.assign(new Error("無法確認雲端最新版本"), { status: response.status });
        const payload = await response.json();
        if (!active || sessionInvalidatedRef.current || captured.accountId !== latestSaveRef.current.accountId || editing()) return;
        if (payload.account?.id !== captured.accountId || !Number.isInteger(payload.account.version) || !payload.dataset) throw new Error("雲端帳本回應無效");
        if (payload.account.version <= (recordVersionRef.current ?? 0)) return;
        if (!canRefreshCloudRecord(latestSaveRef.current.serialized, lastSavedJsonRef.current)) {
          setSaveState("雲端有較新版本；當頁尚有未儲存修改，已保留，請先匯出備份再確認版本");
          return;
        }
        const incoming = normalizeStrategyDataset(payload.dataset) as Dataset;
        const serialized = durableDatasetJson(incoming);
        recordVersionRef.current = payload.account.version;
        lastSavedJsonRef.current = completeTradeJson(incoming);
        lastSavedSnapshotRef.current = incoming;
        latestSaveRef.current = { accountId: captured.accountId, serialized, dataset: incoming };
        loadDataset(incoming);
        setRecordAccounts(payload.accounts || [payload.account]);
        setSaveState(`已更新至雲端最新版本・v${payload.account.version}`);
      }).catch(error => {
        if (!active) return;
        if ([401,403,410].includes(error?.status)) handleSaveError(error);
        else setSaveState("無法確認雲端最新版本；目前內容已保留，請確認網路後重新整理");
      }).finally(() => { checking = false; });
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("visibilitychange", refresh, true);
    const timer = window.setInterval(refresh, 60_000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", refresh); window.removeEventListener("visibilitychange", refresh, true); };
  }, [demo, noLedger, storageReady, cloudReady, storageConflict, activeRecordAccountId, sessionScope, loadDataset, handleSaveError]);
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
        const response = await sessionScope.fetch(`/api/quotes?symbols=${encodeURIComponent(quoteKey)}`, { cache: "no-store", signal: controller.signal });
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
  }, [quoteKey, storageReady, activeRecordAccountId, sessionScope,demo]);

  useEffect(() => {
    if (!storageReady) return;
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      setBenchmarkState(`正在讀取 ${benchmarkSymbol}…`);
      try {
        const payload = await fetchHistoryInBackground(`/api/history?symbol=${encodeURIComponent(benchmarkSymbol)}`, controller.signal, sessionScope.fetch);
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
  }, [benchmarkSymbol, storageReady, activeRecordAccountId, sessionScope]);

  useEffect(() => {
    if (!storageReady) return;
    let active = true;
    const controller = new AbortController();
    const targets = JSON.parse(cycleHistoryKey) as { symbol: string; market: string; start: string; end: string }[];
    const load = async () => {
      if (!targets.length) { setCycleHistoryState("尚無持倉或交易閉環"); return; }
      setCycleHistoryState(`正在同步 ${targets.length} 個標的的 OHLC 日線…`);
      const rows = [] as { bars: HistoryBar[]; error: string | null }[];
      const snapshot = latestSaveRef.current.dataset;
      const force = cycleHistoryRefresh !== historyRefreshUsed.current;
      historyRefreshUsed.current = cycleHistoryRefresh;
      const coverage = snapshot.marketSnapshot?.ohlcCoverage || [];
      const completed: any[] = [];
      for (const target of targets) {
        if (!active) return;
        const providerSymbol = toProviderSymbol(target.symbol, target.market);
        const hasStoredBars = snapshot.marketBars.some((bar:any) => bar.symbol === target.symbol);
        const ranges = missingHistoryRanges(target, hasStoredBars ? coverage : [], Date.now(), force);
        for (const range of ranges) {
          if (!active) return;
          const params = new URLSearchParams({ symbol: providerSymbol, datasetSymbol: target.symbol, start: range.start, end: range.end, mode: "ohlc" });
          try {
            const payload = await fetchHistoryInBackground(`/api/history?${params}`, controller.signal, sessionScope.fetch);
            if (!Array.isArray(payload.bars)) throw new Error("行情格式不完整");
            rows.push({ bars: payload.bars as HistoryBar[], error: null });
            completed.push({symbol:target.symbol,market:target.market,...range,fetchedAt:new Date().toISOString()});
          } catch (error) {
            rows.push({ bars: [], error: `${target.symbol}：${error instanceof Error ? error.message : "讀取失敗"}` });
          }
        }
      }
      if (!active) return;
      const bars = rows.flatMap((row) => row.bars);
      const errors = rows.flatMap((row) => row.error ? [row.error] : []);
      startTransition(() => {
        if (completed.length) setData((current) => ({ ...current, marketBars: mergeMarketBars(current.marketBars || [], bars), marketSnapshot: {...current.marketSnapshot, ohlcCoverage:mergeHistoryCoverage(current.marketSnapshot?.ohlcCoverage || [],completed)} }));
        setCycleHistoryState(errors.length ? `行情補抓有 ${errors.length} 個區間失敗；保留已存資料，可按更新重試` : completed.length ? `已補入 ${bars.length} 筆日線與均線來源資料，隨帳本自動儲存` : "使用帳本已保存的日線與均線來源資料");
      });
    };
    load();
    return () => { active = false; controller.abort(); };
  }, [cycleHistoryKey, cycleHistoryRefresh, storageReady, activeRecordAccountId, sessionScope,setData]);

  const fxQuote = quotes[USDTWD_SYMBOL];
  const fxStale = !fxQuote || isQuoteStale(fxQuote.updatedAt, Date.parse(workspaceNow));
  const fxRate = fxQuote?.price > 0 ? fxQuote.price : null; // Saved FX remains usable, with its stale/as-of label.
  const unrealizedByCurrency = useMemo(() => report.positions.reduce<Record<string, number>>((result: Record<string, number>, position: any) => {
    const quote = quotes[toProviderSymbol(position.symbol, position.market)];
    if (!quote) return result;
    const direction = position.direction === "SHORT" ? -1 : 1;
    result[position.currency] = (result[position.currency] || 0) + (quote.price - position.averageCost) * position.quantity * direction;
    return result;
  }, {}), [quotes, report.positions]);
  const totalPnlByCurrency = useMemo(() => addCurrencyValues(report.realizedPnlByCurrency, unrealizedByCurrency), [report.realizedPnlByCurrency, unrealizedByCurrency]);
  const missingPositionQuote = report.positions.some((position:any) => !(quotes[toProviderSymbol(position.symbol,position.market)]?.price > 0));
  const currentEquity = useMemo(() => {const equity=buildCurrentEquity(data, quotes, fxRate, new Date(workspaceNow));return missingPositionQuote ? {...equity,totalUsd:null,grossPositionValueUsd:null,longPositionValueUsd:null,shortPositionValueUsd:null,exposurePct:null,unpricedPositionCount:Math.max(1,equity.missingSymbols.length)} : equity;}, [data, quotes, fxRate, workspaceNow,missingPositionQuote]);
  const monthKey = currentMonthKey(new Date(workspaceNow));
  const weeklyCycleSummaries = useMemo(() => weeklyCycleStats(report.cycles, fxRate), [report.cycles, fxRate]);
  const rapidRepurchases = useMemo(() => findRapidRepurchases(report.cycles, 3), [report.cycles]);
  const cycleReviews = useMemo(() => linkedCycleReviews(report.cycles, data.positionPlans || {}, data.cycleReviews || {}), [data.cycleReviews, data.positionPlans, report.cycles]);
  const behaviorEvents = useMemo(() => detectBehaviorEvents(report.cycles, data.marketBars, cycleReviews, rapidRepurchases, data.planHistory || [], fxRate), [cycleReviews, data.marketBars, data.planHistory, fxRate, rapidRepurchases, report.cycles]);
  const coachFindings = useMemo(() => buildCoachFindings(behaviorEvents), [behaviorEvents]);
  const activeExperiment = useMemo(() => (data.improvementExperiments || []).find((experiment) => experiment.status === "ACTIVE") || null, [data.improvementExperiments]);
  const activeExperimentResult = useMemo(() => activeExperiment ? evaluateExperiment(activeExperiment, report.cycles, behaviorEvents) : null, [activeExperiment, behaviorEvents, report.cycles]);
  const todayPositionRows = useMemo(() => positionRows(report.positions, quotes, data.positionPlans || {}, currentEquity.totalUsd, fxRate), [currentEquity.totalUsd, data.positionPlans, fxRate, quotes, report.positions]);
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

  async function confirmImport() {
    if (!pendingImport || (!demo&&!online)) return;
    let imported = pendingImport.dataset;
    if ((imported.cashActivities || []).some((activity) => activity.requiresReview)) {
      const account = imported.accounts.find((item) => item.currency === cashCurrency) || imported.accounts[0];
      imported = classifyCashActivities(imported, { currency: cashCurrency, accountId: account.id });
    }
    if (pendingImport.kind === "TradingView CSV" && !(imported.cashActivities || []).length) {
      imported = preserveExistingCashOnFillImport(imported, data);
    }
    setStorageConflict(false);
    loadDataset(imported);
    latestSaveRef.current={accountId:activeRecordAccountId,dataset:imported,serialized:durableDatasetJson(imported)};
    try{await persistCompleteSnapshot(true,"匯入");setMessage(`已匯入並儲存 ${imported.fills.length} 筆成交。`);}catch(error){handleSaveError(error);}
    setPendingImport(null);
  }

  function exportJson() { if(!demo&&!canRefreshCloudRecord(latestSaveRef.current.serialized,lastSavedJsonRef.current)&&!confirm("此匯出包含尚未儲存至雲端的當頁修改，仍要下載？"))return; const url = URL.createObjectURL(new Blob([JSON.stringify(completeSnapshot, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `trade-review-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); setMessage("JSON 備份已下載。"); }
  function finishOnboarding() { setOnboardingOpen(false);void updatePreferences({onboardingDone:true}).catch(()=>{}); }
  async function logout(discard=false) {
    if(demo){location.assign("/login");return;}
    try {
      if (!discard&&!canRefreshCloudRecord(latestSaveRef.current.serialized,lastSavedJsonRef.current)) {
        if(!cloudReady||storageConflict)throw new Error("尚有未儲存修改，請先匯出或選擇放棄當頁修改");
        await persistCompleteSnapshot(true,"登出前");
      }
      await sessionScope.fetch("/api/auth/logout", { method: "POST" });
      sessionScope.stop();
      setSessionEnded(true);
      window.location.replace(user.authProvider === "sites" ? "/signout-with-chatgpt?return_to=%2Flogin" : "/login");
    } catch (error) { handleSaveError(error); }
  }
  function openEntry() {
    if(!demo&&!online)return;
    setData((current) => ({ ...current, simpleEntryDraft:current.simpleEntryDraft||createSimpleDraft(current.accounts,demo?.now()), entryDraft:current.entryDraft||{ ...createEntryDraft(current.accounts,demo?.now()), quoteSnapshot: { quotes, capturedAt: new Date().toISOString() } } }));
    changePage("entry");
  }
  async function submitSimpleEntry(batch:any,key:string) {
    // The confirmation key checks the ledger content. Our own draft autosave may advance
    // the cloud version without changing trades; final PUT still enforces server CAS.
    if(!storageReady||!cloudReady||storageConflict||noLedger||(!demo&&!online))throw new Error('帳本尚未就緒，請先處理同步狀態');
    const current=latestSaveRef.current.dataset;
    if(current.simpleEntryDraft?.id!==batch.id)throw new Error('草稿已變更，請重新確認');
    const next=commitSimpleBatch(current,batch,key,demo?.now()) as Dataset;
    const serialized=durableDatasetJson(next);
    latestSaveRef.current={accountId:activeRecordAccountId,serialized,dataset:next};
    setData(next);
    if(demo)demo.update(next);
    const count=next.fills.length-current.fills.length;
    setSaveState(demo?`已登錄 ${count} 筆・當次訪客練習`:`已登錄 ${count} 筆・正在儲存至雲端`);
    setMessage(`已登錄 ${count} 筆成交；策略與計畫可稍後補充。`);
    try{await persistCompleteSnapshot(true,'成交');changePage('overview');}catch(error){handleSaveError(error);throw error;}
  }
  async function submitEntry(submittedEntry?: any) {
    if (!data.entryDraft) throw new Error("登錄草稿不存在，請重新開啟");
    const entry = submittedEntry || data.entryDraft;
    if (entry.id !== data.entryDraft.id) throw new Error("草稿已變更，請重新確認");
    const next = commitEntry(data, entry, entry.quoteSnapshot || { quotes: {}, capturedAt: new Date().toISOString() },demo?.now()) as Dataset;
    await commitDataset(next,"成交與計畫");
    setMessage(demo?"已登錄示範成交與計畫；當次練習保留，離開後重置。":"已一次登錄成交、計畫與勾選證據；缺項保留為待補，已儲存至雲端。");
    changePage("overview");
  }
  async function saveCashRows(next:Dataset) {
    if(!storageReady||!cloudReady||storageConflict||noLedger||(!demo&&!online))throw new Error('帳本尚未就緒，請先處理同步狀態');
    await commitDataset(next,"資金");
  }
  async function commitDataset(next:Dataset,label:string){
    if(!demo&&(!online||sessionEnded||storageConflict))throw new Error("離線、登入失效或版本衝突，修改尚未儲存");
    latestSaveRef.current={accountId:activeRecordAccountId,dataset:next,serialized:durableDatasetJson(next)};setData(next);
    try{return await persistCompleteSnapshot(true,label);}catch(error){handleSaveError(error);throw error;}
  }
  async function beforeLedgerChange(){if(!noLedger){if(!cloudReady||storageConflict)throw new Error("尚有未儲存修改，請先匯出或重新載入雲端後再切換帳本");await persistCompleteSnapshot(true,'帳本管理');if(completeTradeJson(latestSaveRef.current.dataset)!==lastSavedJsonRef.current)throw new Error('仍有未同步修改，請先完成儲存');}}
  function navigateLedger(id?:string){sessionScope.stop();location.assign(id?`/?accountId=${encodeURIComponent(id)}`:'/');}
  function deleteFill(id:string){void commitDataset({...data,fills:data.fills.filter(fill=>fill.id!==id)},"刪除成交").then(()=>setMessage("成交紀錄已刪除並儲存。")).catch(()=>{}); }
  async function savePositionPlan(position:any,draft:any,batchId:string) {
    if(!storageReady||!cloudReady||storageConflict)throw new Error('帳本尚未就緒或有同步衝突，請先處理後重試');
    const current=latestSaveRef.current.dataset;
    const next=commitPositionPlanEdit(current,position,draft,new Date().toISOString(),batchId) as Dataset;
    await commitDataset(next,"持倉計畫");
  }
  async function saveStrategies(strategies:any[]) {
    if(!storageReady||!cloudReady||storageConflict)throw new Error('帳本尚未就緒或有同步衝突，請先處理後重試');
    const next={...latestSaveRef.current.dataset,strategies};
    latestSaveRef.current={...latestSaveRef.current,dataset:next,serialized:durableDatasetJson(next)};
    setData(next);
    try {await persistCompleteSnapshot(false,'策略');}
    catch(error){handleSaveError(error);throw error;}
  }
  function editDataset(updater:(current:Dataset)=>Dataset){const next=updater(latestSaveRef.current.dataset);void commitDataset(next,'複盤與計畫').catch(()=>{});}
  function updateStageReview(cycleId:string,stageId:string,value:any) {
    editDataset(current=>{const assignment=current.strategyAssignments?.[cycleId];if(!assignment)return current;return {...current,strategyAssignments:{...current.strategyAssignments,[cycleId]:updateStrategyStageReview(assignment,stageId,value)}};});
  }
  function updateCycleReview(cycleId: string, field: CycleReviewField, rawValue: string) {
    const isQualityRating = field === "entryQualityTag" || field === "exitQualityTag";
    if (isQualityRating) {
      editDataset((current) => ({ ...current, cycleReviews: { ...(current.cycleReviews || {}), [cycleId]: updateQualityRating(current.cycleReviews?.[cycleId] || {}, field, rawValue) } }));
      return;
    }
    const value = field === "plannedStop" || field === "revisedStop" ? rawValue === "" ? null : Number(rawValue) : rawValue;
    const updatedAt = new Date().toISOString();
    setData((current) => ({ ...current, cycleReviews: { ...(current.cycleReviews || {}), [cycleId]: { ...(current.cycleReviews?.[cycleId] || {}), [field]: typeof value === "string" || typeof value === "number" && Number.isFinite(value) ? value : null, updatedAt } } }));
  }
  function toggleDecisionLink(pairKey: string) {
    editDataset((current) => {
      const linked = !(current.decisionLinks?.[pairKey]?.linked);
      const updatedAt = new Date().toISOString();
      return { ...current, decisionLinks: { ...(current.decisionLinks || {}), [pairKey]: { linked, updatedAt } }, decisionLinkHistory: [...(current.decisionLinkHistory || []), { pairKey, linked, updatedAt }] };
    });
  }
  function addPlanVersion(version: PlanVersion) {
    editDataset((current) => ({ ...current, planHistory: [...(current.planHistory || []), version] }));
    setMessage(`已新增 ${version.symbol} ${version.field === "stopLoss" ? "停損" : version.field === "takeProfit" ? "停利" : "失效條件"}版本，舊版本已保留。`);
  }
  function startCoachExperiment() {
    const finding = coachFindings[0];
    if (!finding || activeExperiment) return;
    const experiment = createExperimentFromFinding(finding, new Date()) as ImprovementExperiment;
    editDataset((current) => ({ ...current, improvementExperiments: [...(current.improvementExperiments || []), experiment] }));
    setMessage(`已建立「${experiment.title}」兩週改善實驗；同時間只保留一個進行中實驗。`);
  }
  function completeCoachExperiment() {
    if (!activeExperiment) return;
    const updatedAt = new Date().toISOString();
    const resultNote = activeExperimentResult ? `納入 ${activeExperimentResult.eligibleCount} 筆，違規 ${activeExperimentResult.violationCount} 次，影響 USD ${Number(activeExperimentResult.impactUsd || 0).toFixed(2)}` : "手動結束";
    editDataset((current) => ({ ...current, improvementExperiments: (current.improvementExperiments || []).map((experiment) => experiment.id === activeExperiment.id ? { ...experiment, status: "COMPLETED", updatedAt, resultNote } : experiment) }));
    setMessage(`已結束「${activeExperiment.title}」並保留基線與結果。`);
  }
  function assignStrategy(cycle: any, strategyId: string, source = "OPEN_POSITION") {
    const strategy = (data.strategies || []).find((item) => item.id === strategyId);
    if (!strategy) return;
    editDataset((current) => ({ ...current, strategyAssignments: { ...(current.strategyAssignments || {}), [cycle.id]: createStrategyAssignment(cycle, strategy, source) } }));
    setMessage(`已將「${strategy.name}」固定版本指派給 ${cycle.symbol}。`);
  }
  function updateStrategyAudit(cycleId: string, phase: "pre" | "post", ruleId: string, status: string, note: string) {
    editDataset((current) => {
      const assignment = current.strategyAssignments?.[cycleId];
      if (!assignment) return current;
      return { ...current, strategyAssignments: { ...(current.strategyAssignments || {}), [cycleId]: updateStrategyCheck(assignment, phase, ruleId, status, note) } };
    });
  }
  const {history:performanceHistory}=useSyncExternalStore(performanceResource.subscribe,performanceResource.getSnapshot,performanceResource.getSnapshot);
  const fxBars=performanceHistory?.cache?.entries?.['USDTWD=X:raw']?.bars||[];
  const usableFx=fxStale?null:fxRate;
  const selectedCash=currencyTotal(currentEquity.cashByCurrency,valuationCurrency,usableFx);
  const selectedGross=missingPositionQuote?null:currencyTotal(addCurrencyValues(currentEquity.longValueByCurrency as Record<string,number>,currentEquity.shortValueByCurrency as Record<string,number>) as Record<string,number>,valuationCurrency,usableFx);
  const selectedTotal=missingPositionQuote?null:currencyTotal(currentEquity.assetByCurrency,valuationCurrency,usableFx);
  const selectedRealized=realizedValue(report.cycles,valuationCurrency,fxBars);
  const selectedUnrealized=missingPositionQuote?null:currencyTotal(unrealizedByCurrency,valuationCurrency,usableFx);
  const selectedPnl=selectedRealized==null||selectedUnrealized==null?null:selectedRealized+selectedUnrealized;
  const displayMoney=(value:number|null)=>formatCurrency(value,valuationCurrency);
  const ytd=periodValuation(data,performanceHistory?.cache,new Date(workspaceNow),valuationCurrency,selectedTotal,'year');
  const monthReturn=periodValuation(data,performanceHistory?.cache,new Date(workspaceNow),valuationCurrency,selectedTotal,'month');
  const weekReturn=periodValuation(data,performanceHistory?.cache,new Date(workspaceNow),valuationCurrency,selectedTotal,'week');
  const monthSignal = monthlyReturnSignal(monthReturn.rate);
  const metrics = [
    ["目前總資產", displayMoney(selectedTotal), ""],
    ["交易損益", displayMoney(selectedPnl), Object.entries(totalPnlByCurrency).map(([currency, value]) => positionMoney(value, currency)).join(" · ")],
    ["已實現損益", displayMoney(selectedRealized), Object.entries(report.realizedPnlByCurrency as Record<string, number>).map(([currency, value]) => positionMoney(value, currency)).join(" · ")],
    ["完整閉環", report.cycles.length, `${report.positions.length} 個未平倉部位`],
    ["成交紀錄", data.fills.length, `${(data.cashActivities || []).length} 筆資金活動`],
    ["測試結果", `${tests.filter((test: any) => test.passed).length}/${tests.length}`, tests.every((test: any) => test.passed) ? "目前全部通過" : "需要修正"],
  ];
  const hasDataErrors = report.issues.some((issue: any) => issue.level === "error");
  const saveFailed = /失敗|無法|尚未完成|等待重試|衝突|停止覆寫/.test(saveState);
  const messageFailed = /失敗|無法|錯誤/.test(message);
  const noticeTone = hasDataErrors || messageFailed || saveFailed ? "error" : report.qualityPct < 100 || report.issues.length ? "warning" : "info";
  const noticeMessage = saveFailed ? saveState : message.startsWith("資料已從本機") ? "計算與資料完整度分開呈現；行情缺漏不補造價格。" : message;
  const coachBrief = buildCoachBrief({ issues: report.issues, qualityPct: report.qualityPct, storageBlocked: saveFailed, positionRows: todayPositionRows, cycles: report.cycles, reviews: cycleReviews, findings: coachFindings });
  const title = tab === "ledgers" ? "帳本與備份" : tab === "today" ? "今日" : tab === "entry" ? "新增交易" : tab === "overview" || tab === "positions" ? "持倉總覽" : tab === "performance" ? "績效回顧" : tab === "trades" ? "成交與資金" : tab === "cycles" ? "交易復盤" : tab === "strategies" ? "策略" : tab === "training" ? "行為分析" : "資料檢查";
  const navigationTab = tab === "positions" ? "overview" : ["cycles", "strategies", "training"].includes(tab) ? "cycles" : ["trades", "tests"].includes(tab) ? "trades" : tab;

  if (sessionEnded) return <main className="auth-page"><section className="auth-panel"><h1>請重新登入</h1><p>登入已到期或帳號已變更。尚未儲存的修改只保留於當頁，請先匯出再重新登入。</p><button onClick={exportJson}>匯出當頁 JSON</button><a href="/login?error=expired">使用 Google 重新登入</a></section></main>;
  if(!storageReady&&loadingFallback)return loadingFallback;
  return <ValuationProvider rate={fxStale?null:fxRate} resource={performanceResource}><div className="shell trading-workbench">
    <a className="skip-link" href="#workspace-main">跳至主要內容</a>
    <PerformancePreload data={data} resource={performanceResource} enabled={storageReady && !noLedger && !sessionEnded}/>
    <WorkspaceNavigation user={user} demo={!!demo} active={navigationTab} title={title} open={navOpen} onToggle={()=>setNavOpen(v=>!v)} onNavigate={changePage} onLogout={()=>void logout()}/>
    <main className="content" id="workspace-main" tabIndex={-1}>
      <header className="topbar"><div><h1>{title}</h1><div className="workbench-ledger-status"><div className="ledger-identity">{demo?<span>訪客練習</span>:<button className="text-button" onClick={()=>changePage("ledgers")}>{activeRecordAccountName}</button>}<InfoPopover label="帳本狀態" mobilePresentation="sheet"><p>{storageReady?'計算完成':'正在載入'} · 資料完整度 {report.qualityPct}%</p><p>{saveState}</p><button type="button" className="text-button" onClick={() => changePage("tests")}>查看資料檢查</button></InfoPopover></div><span role="status">{demo?null:<button className={`text-button ${saveFailed?"negative":"muted"}`} title={saveState} onClick={()=>changePage("ledgers")}>{saveFailed||storageConflict?saveState:/正在|重新同步/.test(saveState)?'同步中…':/等待|待背景|將隨/.test(saveState)?'尚未儲存':/已儲存/.test(saveState)?'已同步':/已載入/.test(saveState)?'已載入':saveState}</button>}</span></div></div>{tab!=="ledgers"&&tab!=="entry"&&<button className="primary" disabled={!storageReady||noLedger||(!demo&&!online)} onClick={openEntry}>新增交易</button>}</header>
      {!demo&&<input ref={inputRef} hidden type="file" accept=".json,.csv,application/json,text/csv" onChange={event=>prepareImport(event.target.files?.[0])}/>}
      {demo&&!!data.demoWarnings?.length&&<details className="panel"><summary>部分市場資料未取得</summary>{data.demoWarnings.map((warning:string)=><p key={warning}>{warning}</p>)}</details>}
      {!["overview","positions"].includes(tab)&&<ValuationControl/>}{!demo&&!online&&<p role="alert">目前離線，正式帳本暫停修改；可匯出當頁資料。</p>}{demo&&<div className="demo-banner"><div><strong>訪客練習｜真實市場資料・示範交易｜離開後重置</strong><span>USD 50,000 示範本金・未模擬交易成本</span></div><button className="ghost" onClick={()=>{if(confirm('重置所有練習，回到原始示範？'))location.reload();}}>重置示範</button></div>}

      {(noticeTone !== "info" || !storageReady) && <div className={`notice notice-${noticeTone}`} role={noticeTone === "error" ? "alert" : "status"}>
        <b>{!storageReady ? "資料載入中" : hasDataErrors ? "資料需要處理" : saveFailed ? "帳號同步需處理" : messageFailed ? "操作未完成" : !data.fills.length ? "尚無成交資料" : report.qualityPct < 100 || report.issues.length ? "資料仍需補齊" : "計算完成"}</b>
        <span>{storageReady ? noticeMessage : "正在讀取這個帳號的紀錄，請稍候。"}</span>
        {storageReady && <button type="button" className="notice-quality" onClick={() => changePage("tests")}>資料完整度 {report.qualityPct}% · 查看檢查</button>}
      </div>}
      {storageReady && ["cycles", "strategies", "training"].includes(tab) && <nav className="workspace-subnav" aria-label="復盤工具"><button type="button" aria-current={tab === "training" ? "page" : undefined} onClick={() => changePage("training")}>行為分析</button><button type="button" aria-current={tab === "strategies" ? "page" : undefined} onClick={() => changePage("strategies")}>策略管理</button><button type="button" aria-current={tab === "cycles" ? "page" : undefined} onClick={() => changePage("cycles")}>閉環交易</button></nav>}
      {storageReady && ["trades", "tests"].includes(tab) && <nav className="workspace-subnav" aria-label="資料工具"><button type="button" aria-current={tab === "trades" ? "page" : undefined} onClick={() => changePage("trades")}>成交與資金</button><button type="button" aria-current={tab === "tests" ? "page" : undefined} onClick={() => changePage("tests")}>資料檢查</button></nav>}
      {tab==="ledgers"&&!demo&&<section className="ledger-backup-page">
        <LedgerManager embedded currentId={activeRecordAccountId} fetcher={sessionScope.fetch} beforeChange={beforeLedgerChange} onChanged={navigateLedger} onClose={()=>changePage("overview")}/>
        <LegacyRecords userId={user.id} fetcher={sessionScope.fetch} cloudDataset={data}/><section className="backup-tools"><div className="section-title-help"><h2>匯入與備份</h2><InfoPopover label="匯入與備份"><p>帳本統一儲存至雲端；成功回應後才算完成。匯入前可先匯出備份。</p></InfoPopover></div><p role="status">{saveState}</p><div className="actions"><button className="ghost" onClick={()=>{if(confirm('放棄當頁未儲存修改並重新載入雲端？'))location.reload();}}>重新載入雲端</button><button className="ghost" onClick={()=>{if(confirm('放棄當頁未儲存修改並登出？可先匯出 JSON。'))void logout(true);}}>放棄修改並登出</button><button className="primary" disabled={!storageReady||!cloudReady||noLedger||storageConflict||manualSaving} onClick={()=>void manualSave()}>{manualSaving?'儲存中…':'立即儲存'}</button><button className="ghost" disabled={!storageReady||noLedger||!online} onClick={()=>inputRef.current?.click()}>匯入 JSON／CSV</button><button className="ghost" disabled={!storageReady||noLedger} onClick={exportJson}>匯出 JSON 備份</button>{user.isOwner&&<a className="text-button" href="/admin">備份與歷史版本</a>}</div></section>
      </section>}
      <div id="workspace-content" aria-busy={!storageReady}>

      {noLedger && tab!=="ledgers" ? <section className="panel ledger-empty"><h2>建立你的第一份帳本</h2><p>從空白帳本開始，或從回收筒還原。</p><button className="primary" onClick={()=>changePage("ledgers")}>建立／還原帳本</button></section> : !storageReady ? <div className="workspace-loading" role="status"><span/><span/><span/><p>正在載入交易紀錄…</p></div> : <>
      {!demo&&onboardingOpen&&tab!=="today"&&<ProductOnboarding multipleLedgers={user.isOwner} onFinish={finishOnboarding}/>}
      {tab === "today" && <TodayWorkspace brief={coachBrief} positionRows={todayPositionRows} cycles={report.cycles} reviews={cycleReviews} totalEquityUsd={currentEquity.totalUsd} qualityPct={report.qualityPct} onboardingOpen={onboardingOpen} experiment={activeExperiment} experimentResult={activeExperimentResult} experimentSuggestion={activeExperiment ? null : coachFindings[0] || null} onGuide={() => setOnboardingOpen(true)} onGuideFinish={finishOnboarding} onStartExperiment={startCoachExperiment} onCompleteExperiment={completeCoachExperiment} onAction={changePage} onPosition={(positionId) => setSelectedPositionId(positionId)} onCycle={(cycleId) => setSelectedCycleId(cycleId)}/>}
      {(tab === "overview" || tab === "positions") && !data.fills.length && <section className="panel ledger-empty"><h2>{data.cashActivities?.length?'資金已就緒，開始記錄交易':'先登錄資金，建立你的帳本'}</h2><p>入金建立資金基準，成交則記錄實際股數與價格。也可以匯入現有交易紀錄。</p><div className="actions"><button className="primary" onClick={()=>setCashEditor(null)}>新增資金</button><button className="ghost" onClick={openEntry}>新增交易</button>{!demo&&<button className="ghost" disabled={!online} onClick={()=>inputRef.current?.click()}>匯入資料</button>}</div></section>}
      {(tab === "overview" || tab === "positions") && <>
        <section className="quote-bar"><div><span className="live-dot"/> <b>持倉報價</b><InfoPopover label="行情更新"><p>來源：{fxQuote?.source || "Yahoo Finance via MarketDataAdapter"}。匯率報價時間：{localDateTime(fxQuote?.updatedAt)}。</p><p>持倉與 USDTWD 每 30 秒更新。來源與各標的實際報價時間沿用既有行情，可能延遲；失敗時保留上次資料並顯示狀態。</p></InfoPopover><small className={/失敗|無法/.test(quoteState) ? "negative" : ""}>{quoteState}</small><span className={`data-quality-light ${report.issues.some((issue: any) => issue.level === "error") ? "bad" : report.qualityPct === 100 && !missingPositionQuote && !fxStale && !/失敗|無法/.test(quoteState) ? "good" : "warn"}`} role="status" aria-label={`帳本資料品質 ${report.qualityPct}%${missingPositionQuote || fxStale ? "・行情或匯率待更新" : ""}`} title={`帳本資料品質 ${report.qualityPct}%${missingPositionQuote || fxStale ? "・行情或匯率待更新" : ""}`}/></div><div className="fx-rate" title={fxQuote ? `報價時間：${localDateTime(fxQuote.updatedAt)}` : "尚無匯率資料"}><span>USDTWD</span><b>{fxQuote ? fxQuote.price.toFixed(4) : "—"}</b><small className={fxStale ? "negative" : "positive"}>{fxQuote ? fxStale ? "使用上次匯率（待更新）" : "目前匯率" : /失敗|無法/.test(quoteState) ? "缺少匯率" : "正在取得匯率"}</small></div><QuoteRefreshStatus lastQuoteAt={lastQuoteAt}/></section>
        <section className="panel overview-section" id="overview-assets" aria-labelledby="overview-assets-title">
          <header className="overview-section-head"><h2 id="overview-assets-title">資產</h2><ValuationControl/><button className="text-button" onClick={()=>setCashEditor(null)}>新增資金</button></header>
          <InfoPopoverGroup><div className="asset-summary-grid">
            <section className="asset-summary-column asset-summary-total">
              <div className="asset-label">目前總資產<InfoPopover label="總資產" mobilePresentation="sheet"><p>現金水位為帳本現金餘額；持倉水位為多單市值與空單市值絕對值合計。總資產以現金＋多單市值－空單市值計算。</p><p>曝險比率＝持倉水位 ÷ 總資產；各帳戶保留原幣餘額，依有效 USDTWD 換算至所選計價幣別。</p>{currentEquity.totalUsd != null && currentEquity.totalUsd <= 0 && <p>總資產未大於零，曝險比率不適用。</p>}</InfoPopover></div>
              <strong className="asset-value asset-primary"><FitNumber>{metrics[0][1]}</FitNumber></strong><EquityBreakdown equity={currentEquity} display={{total:selectedTotal,cash:selectedCash,gross:selectedGross}} compact/>
            </section>
            <section className="asset-summary-column asset-summary-profits">
              {metrics.slice(1,3).map(([label,value,hint])=><article key={String(label)}><div className="asset-label">{label}<InfoPopover label={String(label)}><p>{hint}</p><p>{String(label).startsWith("交易損益")?"交易損益包含已實現及未實現損益；不含另外登錄的股息、利息與稅費。":"已實現損益沿用成交成本與已登錄費用計算。"}已實現損益依平倉日有效匯率換算；未實現依目前有效匯率換算。</p></InfoPopover></div><strong className="asset-value"><FitNumber>{value}</FitNumber></strong></article>)}
            </section>
            <section className="asset-summary-column asset-summary-returns" aria-label="期間報酬率">
              <article className="asset-month-return"><div className="asset-label"><span className="desktop-only">當月報酬率</span><span className="mobile-only">當月</span><InfoPopover label="當月報酬率" mobilePresentation="sheet"><p>{monthReturn.profit == null?"缺少計算資料":`本月損益 ${displayMoney(monthReturn.profit)}`}</p><p>本月月初至目前，採 Modified Dietz 加權估算，排除入出金本金並考慮投入時間；歷史估值與資金流使用各日有效匯率，包含所選幣別的匯率變動報酬。</p><p>超過 +30% 紫色；≤ −5% 橘色、≤ −8% 紅色、≤ −10% 深紅色；其餘為綠色，缺資料為灰色。依未四捨五入數值判斷。</p>{monthReturn.problems.map((problem:string)=><p key={problem}>{problem}</p>)}</InfoPopover></div><div className="monthly-return-value"><strong className={`asset-value asset-primary ${monthReturn.rate==null?"muted":monthReturn.rate>=0?"positive":"negative"}`}><FitNumber>{pct(monthReturn.rate)}</FitNumber></strong><span className={`monthly-return-light ${monthSignal.tone}`} role="img" aria-label={monthSignal.label} title={monthSignal.label}/></div>{monthReturn.rate==null&&<small>缺少計算資料</small>}</article>
              <div className="asset-secondary-returns">
                <article><div className="asset-label"><span className="desktop-only">YTD 報酬率</span><span className="mobile-only">YTD</span><InfoPopover label="YTD 報酬率" mobilePresentation="sheet"><p>{ytd.profit==null?"缺少計算資料":`今年損益 ${displayMoney(ytd.profit)}`}</p><p>{new Date(workspaceNow).getUTCFullYear()} 年初至目前；採 Modified Dietz 加權估算，排除入出金本金並考慮投入時間。歷史估值與資金流依各日有效匯率換算，包含所選幣別的匯率變動；非時間加權報酬率。</p>{ytd.problems.map((problem:string)=><p key={problem}>{problem}</p>)}</InfoPopover></div><strong className={`asset-value ${ytd.rate==null?"muted":ytd.rate>=0?"positive":"negative"}`}><FitNumber>{pct(ytd.rate)}</FitNumber></strong>{ytd.rate==null&&<small>缺少計算資料</small>}</article>
                <article><div className="asset-label"><span className="desktop-only">當週報酬率</span><span className="mobile-only">當週</span><InfoPopover label="當週報酬率" mobilePresentation="sheet"><p>{weekReturn.profit==null?"缺少計算資料":`本週損益 ${displayMoney(weekReturn.profit)}`}</p><p>本週一至目前（UTC 日期口徑），以上週日結束時資產為基準。採 Modified Dietz 加權估算，排除入出金本金並考慮投入時間；歷史估值與資金流依各日有效匯率換算。</p>{weekReturn.problems.map((problem:string)=><p key={problem}>{problem}</p>)}</InfoPopover></div><strong className={`asset-value ${weekReturn.rate==null?"muted":weekReturn.rate>=0?"positive":"negative"}`}><FitNumber>{pct(weekReturn.rate)}</FitNumber></strong>{weekReturn.rate==null&&<small>缺少計算資料</small>}</article>
              </div>
            </section>
            <section className="asset-summary-column asset-summary-chart"><div className="asset-label">月報酬比較</div><MonthReturnComparison data={data} equity={currentEquity} fx={fxRate} fetcher={sessionScope.fetch}/></section>
          </div></InfoPopoverGroup>
          <MobileDetails label="帳本摘要"><section className="secondary-metrics" aria-label="帳本與系統摘要">{metrics.slice(3).map(([label, value, hint]) => <div key={String(label)}><span>{label} <b>{value}</b></span><small>{hint}</small></div>)}</section></MobileDetails>
          <OverviewDisclosure key={`assets-${activeRecordAccountId}`} id="overview-monthly-assets" label="逐月資產變化圖">
            <MonthlyValuation data={data} asOf={currentEquity.asOf} currentTotal={selectedTotal} cycles={report.cycles}/>
          </OverviewDisclosure>
        </section>
        <section className="panel overview-section" id="overview-holdings" data-holdings-colors={normalizeHoldingsColorScheme(preferences.holdingsColorScheme)} aria-labelledby="overview-holdings-title">
          <header className="overview-section-head"><h2 id="overview-holdings-title">持倉</h2><div className="holdings-color-switch" role="group" aria-label="持倉漲跌配色">{(["green-up","red-up"] as const).map(scheme=><button key={scheme} type="button" disabled={!storageReady || !cloudReady || storageConflict} aria-pressed={normalizeHoldingsColorScheme(preferences.holdingsColorScheme)===scheme} onClick={()=>{
            void updatePreferences({holdingsColorScheme:scheme}).catch(()=>{});
          }}>{scheme==="green-up"?"綠漲紅跌":"紅漲綠跌"}</button>)}</div></header>
          <div className="holdings-summary-layout"><PositionOverview positions={report.positions} quotes={quotes} plans={data.positionPlans || {}} totalAssetUsd={currentEquity.totalUsd} fxRate={fxRate}/><HoldingsHeatmap colorScheme={normalizeHoldingsColorScheme(preferences.holdingsColorScheme)} rows={todayPositionRows} onOpenChart={openPositionChart}/></div>
          <OverviewDisclosure key={`holdings-${activeRecordAccountId}`} id="overview-position-plans" mobileDefaultOpen label={`全部持倉計畫（${report.positions.length} 個部位）`}>
            <PositionsPanel positions={report.positions} quotes={quotes} plans={data.positionPlans || {}} accounts={data.accounts} totalAssetUsd={currentEquity.totalUsd} fxRate={fxRate} onOpenChart={openPositionChart}/>
          </OverviewDisclosure>
        </section>
        <TradeMetrics key={activeRecordAccountId} cycles={report.cycles} monthKey={monthKey} fxRate={fxRate} onSelect={(cycle) => setSelectedCycleId(cycle.id)}/>
      </>}
      {tab === "entry" && (data.entryDraft ? <TradeRegistration key={activeRecordAccountId} userId={user.id} ledgerVersion={recordVersionRef.current} demo={!!demo} now={workspaceNow} data={data} quotes={quotes} fetcher={sessionScope.fetch} onSimpleChange={(draft:any)=>setData(current=>({...current,simpleEntryDraft:draft}))} onSimpleSubmit={submitSimpleEntry} onFullChange={(patch:any) => setData((current) => current.entryDraft?.id === data.entryDraft?.id ? ({ ...current, entryDraft: { ...current.entryDraft, ...patch } }) : current)} onFullSubmit={submitEntry} onBack={() => changePage("overview")}/> : <div className="panel"><p>這個帳號沒有待填草稿。</p><button className="primary" onClick={openEntry}>開始登錄成交</button></div>)}
      {tab === "performance" && <PerformanceWorkspace key={activeRecordAccountId} data={{fills:data.fills,cashActivities:data.cashActivities}} resource={performanceResource}/>}
      {tab === "trades" && <><div className="ledger-switch" role="group" aria-label="帳本內容"><button type="button" aria-pressed={ledgerTab === "fills"} onClick={() => setLedgerTab("fills")}>成交紀錄 <span>{data.fills.length}</span></button><button type="button" aria-pressed={ledgerTab === "cash"} onClick={() => setLedgerTab("cash")}>資金活動 <span>{(data.cashActivities || []).length}</span></button></div>{ledgerTab === "fills" ? <section className="panel"><div className="panel-head"><div><h2>個人成交帳本</h2></div><span className="muted">依成交時間排序</span></div><ul className="mobile-only mobile-record-list" aria-label="成交紀錄">{[...data.fills].sort((a,b)=>b.timestamp.localeCompare(a.timestamp)).map(fill=><li key={fill.id}><header><b>{fill.symbol}・{fill.side==='BUY'?'買進':'賣出'}</b><b>{fill.quantity} 股</b></header><small>{fill.timestamp.slice(0,10)}</small><p>成交價 {money(fill.price,fill.currency)}</p><details><summary>明細與操作</summary><dl><dt>市場／帳戶</dt><dd>{fill.market}・{data.accounts.find(a=>a.id===fill.accountId)?.name||fill.accountId}</dd><dt>成交時間</dt><dd>{fill.timestamp}<small>{simpleTimeLabel((fill as any).timeSource)}</small></dd><dt>費用</dt><dd>{money(fill.fee,fill.currency)}</dd></dl><button className="ghost danger" onClick={()=>{if(confirm(`刪除 ${fill.symbol} ${fill.quantity} 股成交紀錄？`))deleteFill(fill.id);}}>刪除</button></details></li>)}</ul><div className="table-wrap desktop-only" tabIndex={0} role="region" aria-label="資料表，可捲動"><table className="fills-table"><thead><tr><th>日期</th><th>標的</th><th>方向</th><th>數量</th><th>價格</th><th>費用</th><th>操作</th></tr></thead><tbody>{[...data.fills].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map((fill) => <tr key={fill.id}><td>{(fill as any).tradeDate||fill.timestamp.slice(0, 10)}<small className="block">{simpleTimeLabel((fill as any).timeSource)}</small></td><td><b>{fill.symbol}</b><small className="block">{fill.market}</small></td><td><span className={`side ${fill.side.toLowerCase()}`}>{fill.side === "BUY" ? "買進" : "賣出"}</span></td><td>{fill.quantity}</td><td>{money(fill.price, fill.currency)}</td><td>{money(fill.fee, fill.currency)}</td><td><button className="danger" onClick={() => deleteFill(fill.id)}>刪除</button></td></tr>)}</tbody></table></div></section> : <CashLedger activities={data.cashActivities || []} accounts={data.accounts} onAdd={()=>setCashEditor(null)} onEdit={setCashEditor} onDelete={row=>saveCashRows({...latestSaveRef.current.dataset,cashActivities:(latestSaveRef.current.dataset.cashActivities||[]).filter(a=>a.id!==row.id)})} onRestore={row=>saveCashRows(updateCashActivity(latestSaveRef.current.dataset,row) as Dataset)}/>}</>}
      {tab === "cycles" && <>{!demo&&!user.isOwner&&<p className="muted">已完成交易閉環：{report.cycles.length}／500 組</p>}<WeeklyCyclePanel stats={weeklyCycleSummaries} cycles={report.cycles}/><CycleTable cycles={report.cycles} title="全部交易閉環" historyState={cycleHistoryState} onRefresh={() => setCycleHistoryRefresh((value) => value + 1)} onSelect={(cycle) => setSelectedCycleId(cycle.id)}/></>}
      {tab === "strategies" && <StrategyWorkspace strategies={data.strategies || []} assignments={data.strategyAssignments || {}} cycles={report.cycles} fxRate={fxRate} entryContexts={data.entryContexts||{}} onStrategiesChange={saveStrategies} onDirtyChange={dirty=>{strategyDirtyRef.current=dirty;}} onSelectCycle={setSelectedCycleId}/>}
      {tab === "training" && <TrainingWorkspace key={activeRecordAccountId} accountId={activeRecordAccountId} dataset={data} fetchHistory={sessionScope.fetch} cycles={report.cycles} marketBars={data.marketBars} reviews={cycleReviews} fxRate={fxRate} strategies={data.strategies || []} strategyAssignments={data.strategyAssignments || {}} entryContexts={data.entryContexts || {}} onSelectCycle={(cycleId) => setSelectedCycleId(cycleId)}/>}
      {tab === "tests" && <section className="split tests"><CycleRebuildHistory records={(data as any).cycleRebuildHistory||[]}/><article className="panel"><h2>目前資料檢查</h2>{report.issues.length ? <div className="test-list">{report.issues.map((issue: any, index: number) => <div key={`${issue.code}-${index}`}><span className={`test-result ${issue.level === "error" ? "fail" : "warn-dot"}`}>{issue.level === "error" ? "失敗" : "警告"}</span><b>{issue.code}</b><small>{issue.message}</small></div>)}</div> : <Empty text="沒有發現資料問題"/>}</article><article className="panel"><h2>核心計算測試</h2>{tests.some((test:any)=>!test.passed)&&<div className="test-list" role="alert">{tests.filter((test:any)=>!test.passed).map((test:any)=><div key={test.name}><span className="test-result fail">失敗</span><b>{test.name}</b><small>{test.detail}</small></div>)}</div>}<details><summary>已通過 {tests.filter((test:any)=>test.passed).length}／{tests.length} 項</summary><div className="test-list">{tests.filter((test:any)=>test.passed).map((test: any) => <div key={test.name}><span className="test-result pass">通過</span><b>{test.name}</b><small>{test.detail || "通過"}</small></div>)}</div></details></article></section>}
      </>}
      </div>
    </main>

    {cashEditor!==undefined&&<CashEditor activity={cashEditor||undefined} now={workspaceNow} accounts={data.accounts} onSave={row=>saveCashRows(updateCashActivity(latestSaveRef.current.dataset,row) as Dataset)} onClose={()=>setCashEditor(undefined)}/>}
    {pendingImport && <DialogFrame label="匯入資料確認" onClose={() => setPendingImport(null)}><div className="modal import-modal"><div className="panel-head dialog-header"><div><h2>確認匯入資料</h2></div><button type="button" className="close" aria-label="關閉視窗" onClick={() => setPendingImport(null)}>×</button></div><p className="modal-copy">確認後將取代目前交易帳號的帳本，並沿用現有自動儲存流程。請先確認帳號與備份；取消不會修改資料。</p><div className="import-summary"><article><span>格式</span><b>{pendingImport.kind}</b><small>{pendingImport.fileName}</small></article><article><span>成交</span><b>{pendingImport.dataset.fills.length}</b><small>{pendingImport.duplicateCount} 筆與目前ID相同</small></article><article><span>資金活動</span><b>{(pendingImport.dataset.cashActivities || []).length}</b><small>{(pendingImport.dataset.cashActivities || []).filter((activity) => activity.requiresReview).length} 筆待指定幣別</small></article><article><span>行情日線</span><b>{pendingImport.dataset.marketBars.length}</b><small>CSV會保留可匹配的既有日線</small></article></div>{(pendingImport.dataset.cashActivities || []).some((activity) => activity.requiresReview) && <label className="cash-choice">待確認資金活動幣別<select value={cashCurrency} onChange={(event) => setCashCurrency(event.target.value)}><option value="USD">USD 美元</option><option value="TWD">TWD 台幣</option></select></label>}{pendingImport.warnings.length > 0 && <div className="import-warnings"><b>資料提醒</b>{pendingImport.warnings.map((warning, index) => <p key={index}>• {warning}</p>)}</div>}<div className="modal-actions"><button type="button" className="ghost" onClick={() => setPendingImport(null)}>取消</button><button type="button" className="primary" disabled={!demo&&!online} onClick={()=>void confirmImport()}>確認匯入並取代</button></div></div></DialogFrame>}
    {selectedCycle && <CycleReviewDialog entryContexts={data.entryContexts || {}} cycle={selectedCycle} marketBars={data.marketBars} review={cycleReviews[selectedCycle.id] || {}} planHistory={data.planHistory || []} rapidPairs={rapidRepurchases} cycles={report.cycles} decisionLinks={data.decisionLinks || {}} decisionLinkHistory={data.decisionLinkHistory || []} strategies={data.strategies || []} strategyAssignments={data.strategyAssignments || {}} onAssignStrategy={assignStrategy} onStrategyCheck={updateStrategyAudit} onStageReview={updateStageReview} onAddPlanVersion={addPlanVersion} onReviewChange={updateCycleReview} onToggleDecisionLink={toggleDecisionLink} onClose={() => setSelectedCycleId(null)}/>}
    {selectedPosition && <OpenPositionDetail data={data} entryContexts={data.entryContexts || {}} key={`${selectedPosition.id}:${positionEventId || "latest"}`} initialEventId={positionEventId} position={selectedPosition} plan={positionPlanFor(data.positionPlans || {}, selectedPosition)} marketBars={data.marketBars} planHistory={data.planHistory || []} strategies={data.strategies || []} strategyAssignments={data.strategyAssignments || {}} onAssignStrategy={assignStrategy} onStrategyCheck={updateStrategyAudit} onStageReview={updateStageReview} onAddPlanVersion={addPlanVersion} onSavePlan={savePositionPlan} onOpenAnalysis={() => { setSelectedPositionId(null); setTab("training"); }} onClose={() => setSelectedPositionId(null)}/>}
    {selectedPositionClosedCycle && <CycleDetail entryContexts={data.entryContexts || {}} cycle={selectedPositionClosedCycle} marketBars={data.marketBars} review={cycleReviews[selectedPositionClosedCycle.id] || {}} planHistory={data.planHistory || []} rapidPairs={rapidRepurchases} cycles={report.cycles} decisionLinks={data.decisionLinks || {}} decisionLinkHistory={data.decisionLinkHistory || []} strategies={data.strategies || []} strategyAssignments={data.strategyAssignments || {}} onAssignStrategy={assignStrategy} onStrategyCheck={updateStrategyAudit} onStageReview={updateStageReview} onAddPlanVersion={addPlanVersion} onReviewChange={updateCycleReview} onToggleDecisionLink={toggleDecisionLink} onClose={() => setSelectedPositionId(null)}/>}
  </div></ValuationProvider>;
}

type MonthScore = { winningPnlUsd: number | null; losingPnlUsd: number | null; cycles: any[]; averageReturn: number | null; averageWinningReturn: number | null; averageLosingReturn: number | null; averageWinningAmountUsd: number | null; averageLosingAmountUsd: number | null; totalPnlUsd: number | null; winners: number; losers: number; flat: number; winRate: number | null };

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
  return <article className="panel position-overview"><div className="panel-head"><div><div className="section-title-help"><h3>持倉風險</h3><InfoPopover label="持倉風險"><p>部位依即時市值占比排序；停損計畫隨帳本儲存。警示代表目前價格已越過設定停損價。</p></InfoPopover></div></div></div><div className="position-overview-grid"><div><span>未平倉部位</span><b>{rows.length}</b></div><div><span>已設定停損</span><b>{planned}/{rows.length}</b></div><div><span>停損警示</span><b className={alerts ? "negative" : "positive"}>{alerts}</b><small>{alerts ? "已有價格越過停損" : "目前沒有觸發"}</small></div><div><span>最大持倉</span><b>{rows[0]?.position.symbol || "—"}</b><small>{rows[0]?.metrics.allocationPct == null ? "佔比待更新" : `${(rows[0].metrics.allocationPct * 100).toFixed(1)}% 總資產`}</small></div></div></article>;
}

function positionMoney(value: number | null, currency = "USD") { return value == null ? "—" : new Intl.NumberFormat("zh-TW", { style: "currency", currency, currencyDisplay: "code", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value); }

function positionReturnRate(position: { averageCost: number; quantity: number }, unrealized: number | null) {
  const costBasis = position.averageCost * Math.abs(position.quantity);
  if (unrealized == null || !Number.isFinite(unrealized) || !Number.isFinite(costBasis) || costBasis <= 0) return null;
  const rate = unrealized / costBasis;
  return Number.isFinite(rate) ? rate : null;
}

function holdingPnlTone(value: number | null | undefined) { return value == null || !Number.isFinite(value) || value === 0 ? "holding-flat" : value > 0 ? "holding-gain" : "holding-loss"; }

function PositionDayCell({ position, quote }: { position: any; quote: Quote | null | undefined }) {
  const valuation=useValuation();
  const { amount, rate } = positionDayChange(position, quote);
  const tone = holdingPnlTone(amount);
  return <td title={amount == null ? "報價日期、成交或昨收資料不足，無法計算當日損益" : "剩餘 FIFO 持倉：隔夜股數以昨收、當日新增股數以成交價計算，空單反向；損益率以加權基準金額計算。不含已平倉損益及手續費"}><b className={tone}>{valuation.formatNative(amount, position.currency)}</b><small className={`${tone} block`}>{pct(rate)}</small></td>;
}


function MobilePositionList({rows,accountNames,onOpenChart}:{rows:any[];accountNames:Record<string,string>;onOpenChart:(position:any,eventId?:string)=>void}) {
 const valuation=useValuation();
 return <section className="mobile-only mobile-position-list" aria-label="全部持倉計畫">{rows.length?rows.map(({position,quote,plan,metrics},index)=>{
 const day=positionDayChange(position,quote);
 const item=(label:string,value:any,hint?:any,toneValue?:number|null,hintTone?:number|null)=><div key={label}><dt>{label}</dt><dd className={holdingPnlTone(toneValue)}><FitNumber>{String(value)}</FitNumber>{hint!=null&&<small className={holdingPnlTone(hintTone??toneValue)}>{hint}</small>}</dd></div>;
 return <article className="mobile-position" key={positionPlanKey(position)}><header><b>{index+1}. {position.symbol}</b><span className={`direction ${position.direction.toLowerCase()}`}>{position.direction==='SHORT'?'空':'多'}</span><span>{position.quantity} 股</span>{metrics.stopBreached&&<strong className="position-alert">停損觸發</strong>}{!quote&&<strong className="position-alert">缺少報價</strong>}</header><div className="position-value-line" aria-label="部位金額與占比"><FitNumber>{valuation.formatNative(metrics.marketValue,position.currency)}</FitNumber><span>{metrics.allocationPct==null?'—':`${(metrics.allocationPct*100).toFixed(1)}%`}</span></div>
 <dl className="mobile-position-values">{item('當日損益',valuation.formatNative(day.amount,position.currency),pct(day.rate),day.amount)}{item('未實現損益',valuation.formatNative(metrics.unrealized,position.currency),pct(positionReturnRate(position,metrics.unrealized)),metrics.unrealized)}</dl>
 <details className="position-inline-details"><summary aria-label={`${position.symbol} 展開持倉明細`}><svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg><span className="sr-only">持倉明細</span></summary><div className="position-account">{accountNames[position.accountId]||position.accountId}</div><InfoPopover label={`${position.symbol} 計畫計算`} mobilePresentation="sheet"><p>計畫盈虧以計畫價相對即時價的損益，除以全部未平倉部位總市值。預估停損虧損率為停損損失除以目前持倉成本；風險報酬比為當下損益除以停損損失。</p><p>當日損益：隔夜部位以昨收、當日新增以成交價計算，不含已平倉損益及手續費。缺少行情或必要資料時顯示 —。</p></InfoPopover><dl className="mobile-position-values">
 {item('部位金額',valuation.formatNative(metrics.marketValue,position.currency))}{item('即時價',positionMoney(quote?.price??null,position.currency),pct(quote?.changePct),quote?.changePct)}{item('FIFO 均價',positionMoney(position.averageCost,position.currency))}
 {item('停利價',positionMoney(plan.takeProfit,position.currency),metrics.takeProfitPortfolioPct==null?'尚未設定':`總持倉 ${pct(metrics.takeProfitPortfolioPct)}`,undefined,metrics.takeProfitPortfolioPct)}{item('停損價',positionMoney(plan.stopLoss,position.currency),metrics.stopPortfolioPct==null?'尚未設定':`總持倉 ${pct(metrics.stopPortfolioPct)}`,undefined,metrics.stopPortfolioPct)}
 {item('距停損',positionMoney(metrics.stopDistance,position.currency),metrics.stopDistancePct==null?'尚未設定':pct(metrics.stopDistancePct))}{item('預估停損風險',valuation.formatNative(metrics.stopLossAmount,position.currency),pct(positionReturnRate(position,metrics.stopLossAmount==null?null:-metrics.stopLossAmount)),metrics.stopLossAmount==null?null:-metrics.stopLossAmount)}
 {item('即時風險報酬比',metrics.riskReward==null?'—':`${metrics.riskReward.toFixed(2)}x`,undefined,metrics.riskReward)}
 </dl><PositionTransactions position={position} accountName={accountNames[position.accountId]||position.accountId} onOpenChart={onOpenChart}/></details>
 <div className="position-actions"><button className="ghost" type="button" onClick={()=>onOpenChart(position)} aria-label={`${position.symbol} 交易計畫與 K 線`}><svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3v14m5-13v12m5-15v14M3 7h4v5H3zm5-1h4v4H8zm5-2h4v5h-4z" fill="none" stroke="currentColor" strokeWidth="1.3"/></svg>交易計畫</button></div></article>;
 }):<Empty text="目前沒有未平倉部位"/>}</section>;
}

function PositionsPanel({ positions, quotes, plans, accounts, totalAssetUsd, fxRate, onOpenChart }: { positions: any[]; quotes: Record<string, Quote>; plans: Record<string, PositionPlan>; accounts: Dataset["accounts"]; totalAssetUsd: number | null; fxRate: number | null; onOpenChart: (position: any, eventId?: string) => void }) {
 const valuation=useValuation();
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

  return <><MobilePositionList rows={rows} accountNames={accountNames} onOpenChart={onOpenChart}/><div className="position-plan-notice desktop-only"><b>停利／停損為個人交易計畫</b><span>下方盈虧比率＝計畫價相對即時價的預估盈虧 ÷ 全部未平倉部位總市值；計畫會沿同一筆交易 ID 進入閉環與行為分析。</span></div><article className="panel positions-panel desktop-only"><div className="panel-head"><div><h3>全部持倉計畫</h3></div><span className="muted">依持倉佔比排序・{positions.length} 個未平倉部位</span></div>{rows.length ? <div className="table-wrap positions-wrap" tabIndex={0} role="region" aria-label="持倉明細，可橫向捲動"><table className="positions-table"><thead><tr className="column-groups"><th colSpan={2} scope="colgroup">標的與部位</th><th colSpan={3} scope="colgroup">持倉與市值</th><th colSpan={2} scope="colgroup">損益</th><th colSpan={6} scope="colgroup">交易計畫與風險</th></tr><tr><th>排名</th><th>標的／部位</th><th>即時價</th><th>部位金額</th><th>持倉佔比</th><th title="剩餘持倉日損益：隔夜以昨收、當日新增以成交價為基準">即時當日損益</th><th>未實現損益</th><th>停利價／總持倉盈虧</th><th>停損價／總持倉盈虧</th><th>距停損</th><th>預估停損風險</th><th>即時風險報酬比</th><th>K線</th></tr></thead><tbody>{rows.map(({ position, quote, plan, metrics }, index) => <Fragment key={positionPlanKey(position)}><tr className={`${metrics.stopBreached ? "stop-breached" : ""} ${expandedPositions.has(position.id) ? "position-expanded" : ""}`}><td className="rank-cell">{index + 1}</td><td><div className="position-symbol-row"><button type="button" className="position-ledger-toggle" aria-expanded={expandedPositions.has(position.id)} aria-controls={`position-ledger-${encodeURIComponent(position.id)}`} title={`${expandedPositions.has(position.id) ? "收合" : "展開"}交易紀錄 · ${position.fills?.length || 0} 筆`} aria-label={`${position.symbol} 交易紀錄 ${position.fills?.length || 0} 筆`} onClick={() => togglePosition(position.id)}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button><span className={`stop-light ${metrics.stopBreached ? "breach" : "safe"}`} role="img" aria-label={metrics.stopBreached ? "停損觸發" : "正常，尚未觸發停損"} title={metrics.stopBreached ? "即時價格已越過停損價位" : "尚未觸發停損"}/><b>{position.symbol} <span className={`direction ${position.direction.toLowerCase()}`}>{position.direction === "SHORT" ? "空" : "多"}</span></b></div><small className="block">{position.quantity} 股・均價 {positionMoney(position.averageCost, position.currency)}</small></td><td><b className={holdingPnlTone(quote?.changePct)}>{quote ? positionMoney(quote.price, position.currency) : "更新中"}</b><small className={`${holdingPnlTone(quote?.changePct)} block`}>{quote?.changePct == null ? "—" : pct(quote.changePct)}</small></td><td><b>{metrics.marketValue == null ? "—" : valuation.formatNative(metrics.marketValue, position.currency)}</b><small className="block">{positionMoney(metrics.marketValue,position.currency)} 原幣</small></td><td><b>{metrics.allocationPct == null ? "—" : `${(metrics.allocationPct * 100).toFixed(1)}%`}</b></td><PositionDayCell position={position} quote={quote}/><td><b className={holdingPnlTone(metrics.unrealized)}>{metrics.unrealized == null ? "—" : valuation.formatNative(metrics.unrealized, position.currency)}</b><small className={`${holdingPnlTone(metrics.unrealized)} block`} title="損益率＝未實現損益 ÷ 目前持倉成本">{pct(positionReturnRate(position, metrics.unrealized))}</small></td><td><b>{plan.takeProfit == null ? "—" : positionMoney(plan.takeProfit, position.currency)}</b><small className={`${holdingPnlTone(metrics.takeProfitPortfolioPct)} block`}>{metrics.takeProfitPortfolioPct == null ? "尚未設定" : `總持倉 ${pct(metrics.takeProfitPortfolioPct)}`}</small></td><td><b>{plan.stopLoss == null ? "—" : positionMoney(plan.stopLoss, position.currency)}</b><small className={`${holdingPnlTone(metrics.stopPortfolioPct)} block`}>{metrics.stopPortfolioPct == null ? "尚未設定" : `總持倉 ${pct(metrics.stopPortfolioPct)}`}</small></td><td><b className={metrics.stopDistance == null ? "" : metrics.stopDistance >= 0 ? "" : "holding-loss"}>{metrics.stopDistance == null ? "—" : positionMoney(metrics.stopDistance, position.currency)}</b><small className="block">{metrics.stopDistancePct == null ? "尚未設定" : `${(metrics.stopDistancePct * 100).toFixed(1)}%`}</small></td><td><b className={holdingPnlTone(metrics.stopLossAmount == null ? null : -metrics.stopLossAmount)}>{metrics.stopLossAmount == null ? "—" : valuation.formatNative(metrics.stopLossAmount, position.currency)}</b><small className={`${holdingPnlTone(metrics.stopLossAmount == null ? null : -metrics.stopLossAmount)} block`} title="預估虧損率＝停損損失 ÷ 目前持倉成本（均價 × 股數）；以負值表示">{pct(positionReturnRate(position, metrics.stopLossAmount == null ? null : -metrics.stopLossAmount))}</small></td><td><b className={holdingPnlTone(metrics.riskReward)}>{metrics.riskReward == null ? "—" : `${metrics.riskReward.toFixed(2)}x`}</b><small className="block">當下損益 ÷ 停損損失</small></td><td><button type="button" className="ghost" onClick={() => onOpenChart(position)}>看進場與停損K線</button></td></tr><tr className="position-ledger-row" id={`position-ledger-${encodeURIComponent(position.id)}`} hidden={!expandedPositions.has(position.id)}><td colSpan={13}>{expandedPositions.has(position.id) && <PositionTransactions position={position} accountName={accountNames[position.accountId] || position.accountId} onOpenChart={onOpenChart}/>}</td></tr></Fragment>)}</tbody></table></div> : <Empty text="目前沒有未平倉部位"/>}</article></>;
}

function TradeMetrics({ cycles, monthKey, fxRate, onSelect }: { cycles: any[]; monthKey: string; fxRate: number | null; onSelect: (cycle: any) => void }) {
 const valuation=useValuation();
  const [requestedScope, setScope] = useState("year");
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
  const nativeScore=useMemo(()=>cycleRangeScore(cycles,start,end,fxRate),[cycles,start,end,fxRate]);
  const wins=cycleGroupValuation(nativeScore.cycles.filter((c:any)=>c.pnl>0),valuation.currency,valuation.fxBars),losses=cycleGroupValuation(nativeScore.cycles.filter((c:any)=>c.pnl<0),valuation.currency,valuation.fxBars),all=cycleGroupValuation(nativeScore.cycles,valuation.currency,valuation.fxBars);
  const score={...nativeScore,totalPnlUsd:all.total,winningPnlUsd:wins.total,losingPnlUsd:losses.total,averageWinningAmountUsd:wins.average,averageLosingAmountUsd:losses.average};
  const error = selectionError || score.error;
  const periodLabel = scope === "all" ? "總累積" : scope === "year" ? `${selectedYear}年` : `${selectedMonth.slice(0, 4)}年${Number(selectedMonth.slice(5))}月`;
  return <InfoPopoverGroup><section className="panel overview-section trade-metrics-section" id="overview-trade-metrics" aria-labelledby="overview-trade-metrics-title">
    <header className="metrics-toolbar"><div className="metrics-heading"><h2 id="overview-trade-metrics-title">交易量化</h2><InfoPopover label="交易量化" mobilePresentation="sheet"><p>摘要與交易閉環共用所選區間，依出場日期（帳本 UTC）歸屬年份或月份；不影響資產與目前持倉。</p></InfoPopover></div>
    <div className="overview-period-controls" role="group" aria-label="交易量化區間">
      <label>資料區間<select aria-label="交易量化資料區間" value={scope} onChange={event => setScope(event.target.value)}><option value="all">總累積</option><option value="year">年</option><option value="month">月</option></select></label>
      {scope === "year" && <label>年份<select aria-label="交易量化年份" value={selectedYear} onChange={event => setSelection(current => ({ ...current, year: event.target.value }))}>{years.map(year => <option key={year} value={year}>{year}年</option>)}</select></label>}
      {scope === "month" && <label>月份<input aria-label="交易量化月份" type="month" min="1000-01" max="9999-12" value={selectedMonth} onChange={event => setSelection(current => ({ ...current, month: event.target.value }))}/></label>}
      <span className="overview-period-summary" role="status">{error ? "請確認區間" : `${periodLabel}・${score.cycles.length} 筆閉環`}</span>
    </div>
    </header>
    {error ? <p className="overview-period-error" role="alert">{error}</p> : <>
      <MonthScorecard score={score} selectedCurrency/>
      <OverviewDisclosure id="overview-quant-cycles" label={`交易閉環（${score.cycles.length} 筆）`}><CycleTable cycles={score.cycles} title="交易閉環" embedded metricsHelp visibleRows={10} onSelect={onSelect}/></OverviewDisclosure>
    </>}
  </section></InfoPopoverGroup>;
}

function MonthScorecard({ score,selectedCurrency=false }: { score: MonthScore;selectedCurrency?:boolean }) {
 const valuation=useValuation();const usdOrDash=selectedCurrency?valuation.format:valuation.formatUsd;
  const tone = (value: number | null) => value == null || value === 0 ? "" : value > 0 ? "positive" : "negative";
  return <article className="metrics-score" aria-label="交易計分表">
    <div className="metrics-summary">
      <div><div className="metrics-label">總盈虧<InfoPopover label="總盈虧"><p>所選區間已平倉閉環損益加總。依平倉日有效 USDTWD 匯率換算為所選幣別等值；缺少必要匯率時顯示 —。</p></InfoPopover></div><strong className={tone(score.totalPnlUsd)}><FitNumber>{usdOrDash(score.totalPnlUsd)}</FitNumber></strong></div>
      <div><div className="metrics-label">區間平均報酬率<InfoPopover label="區間平均報酬率"><p>所選區間閉環報酬率的算術平均，包含損益兩平交易；不是投資組合累積報酬率。沒有有效樣本時顯示 —。</p></InfoPopover></div><strong className={tone(score.averageReturn)}><FitNumber>{pct(score.averageReturn)}</FitNumber></strong><small>共 {score.cycles.length} 筆閉環</small></div>
      <div><div className="metrics-label">勝率<InfoPopover label="勝率"><p>獲利筆數 ÷（獲利筆數＋虧損筆數），不含損益兩平。沒有獲利或虧損交易時顯示 —。</p></InfoPopover></div><strong>{score.winRate == null ? "—" : `${(score.winRate * 100).toFixed(1)}%`}</strong><small>獲利 {score.winners} ／ 虧損 {score.losers}{score.flat > 0 && ` ／ 兩平 ${score.flat}`}</small></div>
    </div>
    <div className="metrics-comparison-head"><h3>盈虧比較</h3><InfoPopover label="盈虧比較"><p>分別統計獲利與虧損閉環的筆數、報酬率算術平均及所選幣別等值損益平均及各類總損益。無樣本時筆數為 0，平均值為 —；缺少必要匯率時金額為 —。</p></InfoPopover></div>
    <div className="mobile-only"><table className="mobile-profit-comparison" aria-label="盈虧比較"><thead><tr><th scope="col">{valuation.currency} 等值</th><th scope="col">獲利交易</th><th scope="col">虧損交易</th></tr></thead><tbody>{[["交易筆數",score.winners,score.losers,"count"],["平均報酬率",score.averageWinningReturn,score.averageLosingReturn,"rate"],["平均損益",score.averageWinningAmountUsd,score.averageLosingAmountUsd,"money"],["總損益",score.winningPnlUsd,score.losingPnlUsd,"money"]].map(([label,win,loss,format])=><tr key={String(label)}><th scope="row">{label}</th>{[win,loss].map((v,i)=><td key={i} className={format==="count"?"":tone(v as number|null)}><FitNumber>{String(format==="count"?v:format==="rate"?pct(v as number|null):usdOrDash(v as number|null))}</FitNumber></td>)}</tr>)}</tbody></table></div><div className="metrics-comparison-wrap desktop-only" tabIndex={0} role="region" aria-label="盈虧比較，可捲動"><table className="metrics-comparison"><thead><tr><th scope="col">分類</th><th scope="col">交易筆數</th><th scope="col">平均報酬率</th><th scope="col">平均損益（{valuation.currency} 等值）</th><th scope="col">總損益（{valuation.currency} 等值）</th></tr></thead><tbody>
      <tr><th scope="row">獲利交易</th><td>{score.winners}</td><td className={tone(score.averageWinningReturn)}>{pct(score.averageWinningReturn)}</td><td className={tone(score.averageWinningAmountUsd)}>{usdOrDash(score.averageWinningAmountUsd)}</td><td className={tone(score.winningPnlUsd)}>{usdOrDash(score.winningPnlUsd)}</td></tr>
      <tr><th scope="row">虧損交易</th><td>{score.losers}</td><td className={tone(score.averageLosingReturn)}>{pct(score.averageLosingReturn)}</td><td className={tone(score.averageLosingAmountUsd)}>{usdOrDash(score.averageLosingAmountUsd)}</td><td className={tone(score.losingPnlUsd)}>{usdOrDash(score.losingPnlUsd)}</td></tr>
    </tbody></table></div>
  </article>;
}

function WeeklyCyclePanel({ stats:sourceStats,cycles=[] }: { stats: any[];cycles?:any[] }) {
 const valuation=useValuation();const usdOrDash=valuation.format;
 const stats=sourceStats.map(week=>({...week,totalPnlUsd:cycleGroupValuation(cycles.filter(c=>c.closeAt.slice(0,10)>=week.weekStart&&c.closeAt.slice(0,10)<=week.weekEnd),valuation.currency,valuation.fxBars).total}));
 const scrollRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const box=scrollRef.current,table=box?.querySelector('table');if(!box||!table)return;
  const fit=()=>{
   const head=table.querySelector('thead')?.getBoundingClientRect().height||44;
   const rows=Array.from(table.querySelectorAll('tbody tr')).slice(0,8);
   const height=head+rows.reduce((sum,row)=>sum+row.getBoundingClientRect().height,0)+(box.offsetHeight-box.clientHeight)+1;
   const value=height+'px';if(box.style.maxHeight!==value)box.style.maxHeight=value;
  };
  fit();const observer=new ResizeObserver(fit);observer.observe(box);observer.observe(table);return()=>observer.disconnect();
 },[stats]);
 return <section className="panel weekly-cycle-panel"><div className="panel-head"><div><h2>每週閉環統計</h2></div><span className="muted">Asia／Taipei・週一至週日・最新在上</span></div>{stats.length ? <div ref={scrollRef} className="table-wrap weekly-cycle-scroll" tabIndex={0} role="region" aria-label="每週閉環統計，一次顯示八週，可捲動查看較早週次"><table><thead><tr><th>週期</th><th>樣本</th><th>平均報酬</th><th>獲利：虧損</th><th>獲利交易率</th><th>總盈虧（{valuation.currency}等值）</th></tr></thead><tbody>{stats.map((week) => <tr key={week.weekStart}><td>{week.weekStart} → {week.weekEnd}</td><td>{week.sampleCount}</td><td className={week.averageReturn == null ? "" : week.averageReturn >= 0 ? "positive" : "negative"}>{pct(week.averageReturn)}</td><td>{week.winners}：{week.losers}</td><td>{week.winRate == null ? "—" : `${(week.winRate * 100).toFixed(1)}%`}</td><td className={week.totalPnlUsd == null ? "" : week.totalPnlUsd >= 0 ? "positive" : "negative"}>{usdOrDash(week.totalPnlUsd)}</td></tr>)}</tbody></table></div> : <Empty text="目前沒有可分組的閉環樣本"/>}</section>; }

function CycleDetail({ entryContexts, cycle, marketBars, review, planHistory, rapidPairs, cycles, decisionLinks, decisionLinkHistory, strategies, strategyAssignments, onAssignStrategy, onStrategyCheck, onStageReview, onAddPlanVersion, onReviewChange, onToggleDecisionLink, onClose }: { onStageReview?: any; entryContexts: Record<string, any>; cycle: any; marketBars: Record<string, unknown>[]; review: CycleReview; planHistory: PlanVersion[]; rapidPairs: any[]; cycles: any[]; decisionLinks: Record<string, DecisionLink>; decisionLinkHistory: DecisionLinkEvent[]; strategies: any[]; strategyAssignments: Record<string, any>; onAssignStrategy: (cycle: any, strategyId: string, source: string) => void; onStrategyCheck: (cycleId: string, phase: "pre" | "post", ruleId: string, status: string, note: string) => void; onAddPlanVersion: (version: PlanVersion) => void; onReviewChange: (cycleId: string, field: CycleReviewField, value: string) => void; onToggleDecisionLink: (pairKey: string) => void; onClose: () => void }) {
  return <CycleReviewDialog {...{ entryContexts, cycle, marketBars, review, planHistory, rapidPairs, cycles, decisionLinks, decisionLinkHistory, strategies, strategyAssignments, onAssignStrategy, onStrategyCheck, onStageReview, onAddPlanVersion, onReviewChange, onToggleDecisionLink, onClose }}/>;
}

function CycleTable({ cycles, title, embedded = false, metricsHelp = false, visibleRows, historyState, onRefresh, onSelect }: { visibleRows?: number; cycles: any[]; title: string; embedded?: boolean; metricsHelp?: boolean; historyState?: string; onRefresh?: () => void; onSelect?: (cycle: any) => void }) {
 const valuation=useValuation();
 const [sort,setSort]=useState({key:"closeAt",direction:"desc"});
 const rows=useMemo(()=>{if(sort.key!=='pnl')return sortCycleRows(cycles,sort.key,sort.direction);return sortCycleRows(cycles.map(c=>({...c,pnl:cycleValue(c,c.pnl,valuation.currency,valuation.fxBars),original:c})),sort.key,sort.direction).map(c=>c.original);},[cycles,sort,valuation.currency,valuation.fxBars]);
 const scrollRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const box=scrollRef.current,table=box?.querySelector('table');if(!visibleRows||!box||!table)return;
  const fit=()=>{const head=table.querySelector('thead')?.getBoundingClientRect().height||0;const displayed=Array.from(table.querySelectorAll('tbody tr')).slice(0,visibleRows);const height=head+displayed.reduce((sum,row)=>sum+row.getBoundingClientRect().height,0)+(box.offsetHeight-box.clientHeight);if(height>0)box.style.maxHeight=`${height}px`;};
  fit();const observer=new ResizeObserver(fit);observer.observe(table);return()=>observer.disconnect();
 },[rows,visibleRows]);
 const columns=[["symbol","標的"],["direction","方向"],["closeAt","期間"],["averageEntry","進場價"],["averageExit","出場價"],["holdingDays","持倉"],["pnl","損益"],["returnPct","報酬"],["maePct","MAE"],["mfePct","MFE"],["quality","行情"]];
 return <section className="panel"><div className="panel-head"><div>{!embedded && <h2>{title}</h2>}{metricsHelp && <InfoPopover label="交易閉環" mobilePresentation="sheet"><p>依 FIFO（先進先出）配對成交，包含多單與空單；持倉天數採日曆日。預設依最近平倉日期排序，可點選欄名切換排序。</p><p>MAE 為持倉期間最大不利價格變動，MFE 為最大有利價格變動；行情欄顯示資料完整程度。進出場價保留原幣，損益依平倉日匯率換算所選幣別，詳情可查看成交與複盤證據。</p></InfoPopover>}</div>{onRefresh ? <div className="cycle-actions"><span className="muted">{historyState}</span><button className="ghost" type="button" onClick={onRefresh}>更新閉環行情</button></div> : !metricsHelp && <span className="muted">FIFO・多空雙向・日曆日</span>}</div>{cycles.length ? <div ref={scrollRef} className="table-wrap" tabIndex={0} role="region" aria-label={visibleRows?`交易閉環，一次顯示 ${visibleRows} 筆，可捲動查看其餘交易`:"資料表，可捲動"}><table className="cycles-table"><thead><tr>{columns.map(([key,label])=><th key={key} scope="col" aria-sort={sort.key===key?(sort.direction==='asc'?'ascending':'descending'):'none'}><button type="button" className="cycle-sort-button" title={key==='closeAt'?'依平倉日期排序':key==='pnl'||key==='averageEntry'||key==='averageExit'?'依顯示數值排序':undefined} aria-label={`${label}，${sort.key===key&&sort.direction==='asc'?'改為降冪':'改為升冪'}排序`} onClick={()=>setSort({key,direction:sort.key===key&&sort.direction==='asc'?'desc':'asc'})}>{label}<svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true"><path d="m3 5 3-3 3 3" fill="none" stroke="currentColor" opacity={sort.key===key&&sort.direction==='asc'?1:.3}/><path d="m3 9 3 3 3-3" fill="none" stroke="currentColor" opacity={sort.key===key&&sort.direction==='desc'?1:.3}/></svg></button></th>)}<th>操作</th></tr></thead><tbody>{rows.map((cycle) => <tr key={cycle.id}><td><b>{cycle.symbol}</b></td><td><span className={`direction ${cycle.direction.toLowerCase()}`}>{cycle.direction === "SHORT" ? "空" : "多"}</span></td><td>{cycle.openAt.slice(0, 10)} → {cycle.closeAt.slice(0, 10)}</td><td>{money(cycle.averageEntry, cycle.currency)}</td><td>{money(cycle.averageExit, cycle.currency)}</td><td>{cycle.holdingDays} 天</td><td className={cycle.pnl >= 0 ? "positive" : "negative"}>{valuation.format(cycleValue(cycle,cycle.pnl,valuation.currency,valuation.fxBars))}<small className="block">{money(cycle.pnl,cycle.currency)} 原幣</small></td><td>{pct(cycle.returnPct)}</td><td>{pct(cycle.maePct)}</td><td>{pct(cycle.mfePct)}</td><td><span className={cycle.quality === "完整" ? "status ok" : "status warn"}>{cycle.quality}</span></td><td><button className="text-button" type="button" aria-label={`查看 ${cycle.symbol} ${cycle.closeAt.slice(0, 10)} 交易閉環詳情`} onClick={() => onSelect?.(cycle)}>詳情</button></td></tr>)}</tbody></table></div> : <Empty text="尚未形成完整交易閉環"/>}</section>; }
function QuoteRefreshStatus({ lastQuoteAt }: { lastQuoteAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const nextRefresh = lastQuoteAt == null ? 0 : Math.max(0, Math.ceil((QUOTE_REFRESH_MS - (now - lastQuoteAt)) / 1000));
  return <div><b>{lastQuoteAt ? new Date(lastQuoteAt).toLocaleTimeString("zh-TW") : "—"}</b><small className="quote-refresh-countdown">{lastQuoteAt ? `${nextRefresh} 秒後背景更新` : "正在背景取得報價"}</small></div>;
}
function Empty({ text }: { text: string }) { return <div className="empty"><span>○</span><p>{text}</p></div>; }
