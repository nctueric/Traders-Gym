import test from "node:test";
import assert from "node:assert/strict";
import { buildCycles, runSelfTests, summarize, validateDataset } from "../lib/trade-engine.mjs";

const fills = [
  { id: "b1", accountId: "a", symbol: "XYZ", side: "BUY", quantity: 10, price: 100, fee: 1, timestamp: "2026-07-01T09:00:00Z" },
  { id: "b2", accountId: "a", symbol: "XYZ", side: "BUY", quantity: 5, price: 110, fee: 1, timestamp: "2026-07-02T09:00:00Z" },
  { id: "s1", accountId: "a", symbol: "XYZ", side: "SELL", quantity: 15, price: 120, fee: 2, timestamp: "2026-07-05T09:00:00Z" }
];
const bars = [{ symbol: "XYZ", date: "2026-07-03", open: 103, high: 125, low: 90, close: 118 }];

test("browser self-tests all pass", () => assert.equal(runSelfTests().every((item) => item.passed), true));
test("FIFO cycle calculates realized P&L including fees", () => assert.equal(summarize({ fills, marketBars: bars }).cycles[0].pnl, 246));
test("closed cycle exposes weighted entry and exit prices", () => { const cycle = summarize({ fills, marketBars: bars }).cycles[0]; assert.equal(cycle.averageEntry, 1550 / 15); assert.equal(cycle.averageExit, 120); });
test("partial sell keeps an open position", () => assert.equal(buildCycles({ fills: [fills[0], { ...fills[2], quantity: 4 }], marketBars: bars }).positions[0].quantity, 6));
test("same account and symbol are paired while other symbols remain isolated", () => assert.equal(buildCycles({ fills: [...fills, { ...fills[0], id: "other", symbol: "ABC" }], marketBars: bars }).positions[0].symbol, "ABC"));
test("duplicate fill id is invalid", () => assert.ok(validateDataset({ fills: [fills[0], fills[0]], marketBars: [] }).some((issue) => issue.code === "DUPLICATE_ID")));
test("short sale followed by buy forms a short cycle", () => { const cycle = buildCycles({ fills: [{ ...fills[0], side: "SELL", price: 120 }, { ...fills[2], side: "BUY", quantity: 10, price: 100 }], marketBars: [] }).cycles[0]; assert.equal(cycle.direction, "SHORT"); assert.equal(cycle.pnl, 197); });
test("oversized reverse fill is rejected", () => assert.equal(buildCycles({ fills: [fills[0], { ...fills[2], quantity: 11 }], marketBars: [] }).issues[0].code, "POSITION_FLIP"));
test("missing bars do not fabricate MAE or MFE", () => { const cycle = buildCycles({ fills, marketBars: [] }).cycles[0]; assert.equal(cycle.maePct, null); assert.equal(cycle.mfePct, null); });
test("open position weighted average is deterministic", () => assert.equal(buildCycles({ fills: fills.slice(0,2), marketBars: [] }).positions[0].averageCost, 1550 / 15));
test("realized P&L is separated by currency", () => {
  const twd = fills.map((fill) => ({ ...fill, id: `${fill.id}-tw`, symbol: "2330", accountId: "tw", currency: "TWD" }));
  const result = summarize({ fills: [...fills, ...twd], marketBars: bars });
  assert.equal(result.realizedPnlByCurrency.USD, 246); assert.equal(result.realizedPnlByCurrency.TWD, 246);
});
