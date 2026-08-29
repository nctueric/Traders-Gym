import { summarize } from "../lib/trade-engine.mjs";
import { createStrategy, publishStrategyVersion, createStrategyAssignment } from "../lib/strategy-engine.mjs";

export function fixtureBars(symbol) {
  return Array.from({ length: 310 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 11, 1 + index)).toISOString().slice(0, 10);
    const close = 100 + Math.sin(index / 5) * 10 + index / 25;
    return { symbol, date, open: close - 1, high: close + 3, low: close - 4, close, volume: 100000 };
  });
}

export function fixtureDataset(scenario = "rich") {
  const dataset = {
    version: "0.1.0",
    profile: { name: "隔離 UI 測試帳號", baseCurrency: "USD", costMethod: "FIFO" },
    accounts: [{ id: "main", name: "測試美元帳戶", currency: "USD" }, { id: "tw", name: "測試台幣帳戶", currency: "TWD" }],
    fills: [], cashActivities: [
      { id: "cash-usd", type: "DEPOSIT", amount: 50000, timestamp: "2026-01-01T00:00:00Z", accountId: "main", currency: "USD" },
      { id: "cash-twd", type: "DEPOSIT", amount: 300000, timestamp: "2026-01-01T00:00:00Z", accountId: "tw", currency: "TWD" },
    ], marketBars: [], settings: { quoteProvider: "json", benchmarkSymbol: "SPY" },
    positionPlans: {}, cycleReviews: {}, decisionLinks: {}, decisionLinkHistory: [], planHistory: [], improvementExperiments: [], strategies: [], strategyAssignments: {},
  };
  if (scenario === "empty") return { ...dataset, cashActivities: [] };
  for (let index = 0; index < 32; index += 1) {
    const symbol = index % 4 === 0 ? "QA2330" : ["QAALPHA", "QABETA", "QAGAMMA"][index % 3];
    const short = index % 5 === 0;
    const month = String(Math.floor(index / 4) + 1).padStart(2, "0");
    const day = String((index % 4) * 6 + 1).padStart(2, "0");
    const closeDay = String((index % 4) * 6 + 4).padStart(2, "0");
    const shared = { accountId: symbol === "QA2330" ? "tw" : "main", symbol, currency: symbol === "QA2330" ? "TWD" : "USD", market: symbol === "QA2330" ? "TWSE" : "NASDAQ", quantity: 10, fee: 0 };
    dataset.fills.push(
      { ...shared, id: `qa-${index}-entry`, side: short ? "SELL" : "BUY", price: 100, timestamp: `2026-${month}-${day}T09:30:00Z`, note: "隔離合成資料，非投資建議" },
      { ...shared, id: `qa-${index}-exit`, side: short ? "BUY" : "SELL", price: index % 6 === 0 ? 100 : index % 2 === 0 ? 120 : 90, timestamp: `2026-${month}-${closeDay}T09:30:00Z` },
    );
  }
  dataset.fills.push({ id: "qa-open", accountId: "main", symbol: "QAHOLD", currency: "USD", market: "NASDAQ", quantity: 25, fee: 1, side: "BUY", price: 100, timestamp: "2026-08-25T09:30:00Z", note: "未平倉測試" });
  dataset.marketBars = [...new Set(dataset.fills.map(fill => fill.symbol))].flatMap(fixtureBars);
  const rules = [
    { id: "qa-market", group: "MARKET_CONDITION", name: "市場條件", criterion: "測試市場條件已確認" },
    { id: "qa-entry", group: "ENTRY_TRIGGER", name: "進場條件", criterion: "測試進場觸發已確認" },
    { id: "qa-exit", group: "EXIT_TRIGGER", name: "出場条件", criterion: "測試停損／停利條件", appliesWhen: "ALWAYS" },
  ];
  const draft = { ...createStrategy({ name: "測試趨勢策略", description: "僅供介面驗收", rules }, "2026-01-01T00:00:00Z"), id: "qa-strategy" };
  const active = publishStrategyVersion(draft, rules, "測試初始版本", "2026-01-01T00:00:00Z").strategy;
  dataset.strategies = [active, { ...draft, id: "qa-draft", name: "測試草稿策略" }];
  const report = summarize(dataset);
  report.cycles.forEach((cycle, index) => {
    if (index % 4 !== 0) dataset.cycleReviews[cycle.id] = { entryQualityTag: ["EARLY", "LATE", "IDEAL", "WRONG_ENTRY"][index % 4], exitQualityTag: ["EARLY", "LATE", "IDEAL"][index % 3], qualityRatedAt: "2026-08-27T00:00:00Z", reflection: "合成復盤文字" };
    if (index % 3 !== 0) dataset.strategyAssignments[cycle.id] = createStrategyAssignment(cycle, active, "HISTORICAL_BATCH", "2026-08-27T00:00:00Z");
  });
  if (scenario === "missing") {
    dataset.marketBars = [];
    dataset.cashActivities.push({ id: "qa-unconfirmed", type: "DEPOSIT", amount: 3000, timestamp: "2026-08-01T00:00:00Z", accountId: null, currency: null, requiresReview: true });
  }
  if (scenario === "legacy") {
    delete dataset.cycleReviews;
    delete dataset.strategyAssignments;
    delete dataset.strategies;
    delete dataset.planHistory;
  }
  if (scenario === "long-text") {
    dataset.profile.name = "隔離長帳號名称".repeat(12);
    dataset.strategies[0].description = "此段內容用於測試長文字換行與閱讀，不應造成整頁橫向溢出。".repeat(25);
    dataset.positionPlans["main:QAHOLD"] = { note: "LongUnbrokenPlanText".repeat(30) };
  }
  return dataset;
}
