const DAY = 86_400_000;

export const STORAGE_KEY = "trade-review.phase0.v1";

export function validateDataset(data) {
  const issues = [];
  if (!data || typeof data !== "object") return [{ level: "error", code: "INVALID_ROOT", message: "JSON 根節點必須是物件" }];
  if (!Array.isArray(data.fills)) issues.push({ level: "error", code: "FILLS_REQUIRED", message: "缺少 fills 成交陣列" });
  if (!Array.isArray(data.marketBars)) issues.push({ level: "warning", code: "BARS_MISSING", message: "尚未提供每日行情，MAE／MFE 將無法計算" });
  const ids = new Set();
  for (const [index, fill] of (data.fills || []).entries()) {
    const label = `第 ${index + 1} 筆成交`;
    if (!fill.id) issues.push({ level: "error", code: "FILL_ID", message: `${label}缺少 id` });
    else if (ids.has(fill.id)) issues.push({ level: "error", code: "DUPLICATE_ID", message: `成交 id 重複：${fill.id}` });
    ids.add(fill.id);
    if (!fill.symbol || !fill.timestamp || !["BUY", "SELL"].includes(fill.side)) issues.push({ level: "error", code: "FILL_FIELDS", message: `${label}缺少標的、日期或買賣方向` });
    if (!(Number(fill.quantity) > 0) || !(Number(fill.price) > 0) || Number(fill.fee || 0) < 0) issues.push({ level: "error", code: "FILL_NUMBERS", message: `${label}的數量、價格或手續費不正確` });
  }
  for (const bar of data.marketBars || []) {
    const values = [bar.open, bar.high, bar.low, bar.close].map(Number);
    if (!bar.symbol || !bar.date || values.some((v) => !Number.isFinite(v) || v <= 0) || Number(bar.high) < Number(bar.low)) {
      issues.push({ level: "error", code: "BAR_INVALID", message: `行情資料不正確：${bar.symbol || "未知標的"} ${bar.date || "未知日期"}` });
    }
  }
  return issues;
}

export function buildCycles(data) {
  const fills = [...(data.fills || [])].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const bars = data.marketBars || [];
  const states = new Map();
  const cycles = [];
  const issues = [];

  for (const fill of fills) {
    const key = `${fill.accountId || "default"}:${fill.symbol}`;
    const state = states.get(key) || { lots: [], active: null };
    const qty = Number(fill.quantity);
    const price = Number(fill.price);
    const fee = Number(fill.fee || 0);
    if (fill.side === "BUY") {
      if (!state.active) state.active = { id: `cycle-${fill.id}`, accountId: fill.accountId || "default", symbol: fill.symbol, currency: fill.currency || "USD", openAt: fill.timestamp, fills: [], cost: 0, proceeds: 0, fees: 0, quantity: 0 };
      state.lots.push({ quantity: qty, price, feePerUnit: fee / qty });
      state.active.fills.push(fill);
      state.active.quantity += qty;
      state.active.cost += qty * price;
      state.active.fees += fee;
    } else {
      let remaining = qty;
      const available = state.lots.reduce((sum, lot) => sum + lot.quantity, 0);
      if (remaining > available + 1e-9) {
        issues.push({ level: "error", code: "OVERSELL", message: `${fill.symbol} 於 ${fill.timestamp.slice(0, 10)} 賣出 ${qty}，超過可用持倉 ${available}` });
        continue;
      }
      state.active.fills.push(fill);
      state.active.proceeds += qty * price;
      state.active.fees += fee;
      while (remaining > 1e-9) {
        const lot = state.lots[0];
        const used = Math.min(remaining, lot.quantity);
        lot.quantity -= used;
        remaining -= used;
        if (lot.quantity <= 1e-9) state.lots.shift();
      }
      if (!state.lots.length) {
        const cycle = finalizeCycle(state.active, fill.timestamp, bars);
        cycles.push(cycle);
        state.active = null;
      }
    }
    states.set(key, state);
  }
  const positions = [...states.values()].filter((s) => s.lots.length).map((s) => ({
    accountId: s.active.accountId,
    symbol: s.active.symbol,
    currency: s.active.currency,
    quantity: s.lots.reduce((sum, lot) => sum + lot.quantity, 0),
    averageCost: s.lots.reduce((sum, lot) => sum + lot.quantity * lot.price, 0) / s.lots.reduce((sum, lot) => sum + lot.quantity, 0),
    openAt: s.active.openAt,
  }));
  return { cycles, positions, issues };
}

function finalizeCycle(active, closeAt, allBars) {
  const pnl = active.proceeds - active.cost - active.fees;
  const returnPct = active.cost ? pnl / active.cost : 0;
  const start = active.openAt.slice(0, 10);
  const end = closeAt.slice(0, 10);
  const averageEntry = active.cost / active.quantity;
  const bars = allBars.filter((b) => b.symbol === active.symbol && b.date >= start && b.date <= end);
  const maePct = bars.length ? Math.min(...bars.map((b) => Number(b.low) / averageEntry - 1)) : null;
  const mfePct = bars.length ? Math.max(...bars.map((b) => Number(b.high) / averageEntry - 1)) : null;
  return { ...active, closeAt, pnl, returnPct, averageEntry, holdingDays: Math.max(0, Math.round((new Date(closeAt) - new Date(active.openAt)) / DAY)), maePct, mfePct, barCount: bars.length, quality: bars.length ? "完整" : "缺行情" };
}

export function summarize(data) {
  const validation = validateDataset(data);
  const built = buildCycles(data);
  const issues = [...validation, ...built.issues];
  const realizedPnl = built.cycles.reduce((sum, cycle) => sum + cycle.pnl, 0);
  const validCycles = built.cycles.filter((cycle) => cycle.barCount > 0).length;
  return { ...built, issues, realizedPnl, qualityPct: built.cycles.length ? Math.round(validCycles / built.cycles.length * 100) : 0 };
}

export function runSelfTests() {
  const cases = [];
  const test = (name, fn) => { try { fn(); cases.push({ name, passed: true }); } catch (error) { cases.push({ name, passed: false, detail: error.message }); } };
  const expect = (condition, message) => { if (!condition) throw new Error(message); };
  const demo = { fills: [
    { id: "b1", accountId: "a", symbol: "AAA", side: "BUY", quantity: 10, price: 100, fee: 1, timestamp: "2026-07-01T09:00:00Z" },
    { id: "b2", accountId: "a", symbol: "AAA", side: "BUY", quantity: 10, price: 110, fee: 1, timestamp: "2026-07-02T09:00:00Z" },
    { id: "s1", accountId: "a", symbol: "AAA", side: "SELL", quantity: 20, price: 120, fee: 2, timestamp: "2026-07-05T09:00:00Z" },
  ], marketBars: [{ symbol: "AAA", date: "2026-07-03", open: 104, high: 126, low: 90, close: 119 }] };
  const result = summarize(demo);
  test("兩次買進一次賣出形成一個閉環", () => expect(result.cycles.length === 1, "閉環數應為 1"));
  test("損益包含全部手續費", () => expect(result.cycles[0].pnl === 296, "損益應為 296"));
  test("持倉天數正確", () => expect(result.cycles[0].holdingDays === 4, "持倉應為 4 天"));
  test("MAE 依期間最低價計算", () => expect(Math.abs(result.cycles[0].maePct - (-0.142857142857)) < 1e-6, "MAE 不符"));
  test("MFE 依期間最高價計算", () => expect(Math.abs(result.cycles[0].mfePct - 0.2) < 1e-6, "MFE 不符"));
  test("未平倉部位保留在持倉", () => expect(buildCycles({ fills: demo.fills.slice(0, 1), marketBars: [] }).positions[0].quantity === 10, "持倉數量不符"));
  test("超賣會被攔截", () => expect(buildCycles({ fills: [demo.fills[2]], marketBars: [] }).issues[0].code === "OVERSELL", "應回報超賣"));
  test("重複 ID 會被偵測", () => expect(validateDataset({ fills: [demo.fills[0], demo.fills[0]], marketBars: [] }).some((i) => i.code === "DUPLICATE_ID"), "應偵測重複 ID"));
  test("缺少行情會標示品質", () => expect(buildCycles({ fills: demo.fills, marketBars: [] }).cycles[0].quality === "缺行情", "品質應為缺行情"));
  return cases;
}
