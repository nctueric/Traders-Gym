import test from "node:test";
import assert from "node:assert/strict";
import { buildCycles } from "../lib/trade-engine.mjs";
import { buildCurrentEquity } from "../lib/portfolio-engine.mjs";
import { buildOpenPositionReplay } from "../lib/coach-engine.mjs";
import { buildPositionLedger, replayFocus } from "../lib/position-ledger.mjs";

const fill = (id, side, quantity, price, date, extra = {}) => ({ id, side, quantity, price, timestamp: date + "T00:00:00Z", fee: 0, accountId: "a", symbol: "ORCL", currency: "USD", ...extra });
const positionFor = (fills) => buildCycles({ fills, marketBars: [] }).positions[0];

test("ORCL three entries reconstruct 491 shares, newest first without rewriting fills", () => {
  const position = positionFor([fill("a", "BUY", 219, 141.98, "2026-08-05"), fill("b", "BUY", 172, 152.74, "2026-08-15"), fill("c", "BUY", 100, 145.47, "2026-08-20")]);
  const before = JSON.stringify(position);
  const ledger = buildPositionLedger(position);
  assert.deepEqual(ledger.rows.map(row => [row.id, row.beforeQuantity, row.afterQuantity]), [["c",391,491],["b",219,391],["a",0,219]]);
  assert.equal(ledger.rows[0].notional, 14547);
  assert.equal(ledger.quantityMatches, true);
  assert.equal(JSON.stringify(position), before);
});

test("partial exits stay visible while FIFO remaining cost stays unchanged", () => {
  const position = positionFor([fill("a", "BUY", 10, 100, "2026-07-01"), fill("b", "BUY", 5, 120, "2026-07-02"), fill("c", "SELL", 12, 130, "2026-07-03")]);
  const ledger = buildPositionLedger(position);
  assert.equal(position.averageCost, 120);
  assert.equal(ledger.fillCount, 3);
  assert.equal(ledger.rows[0].type, "REDUCE");
  assert.equal(ledger.rows[0].afterQuantity, 3);
  assert.equal(ledger.reductionCount, 1);
});

test("short sells open/add and buys cover without inverting quantities", () => {
  const ledger = buildPositionLedger(positionFor([fill("a", "SELL", 10, 100, "2026-07-01"), fill("b", "SELL", 5, 110, "2026-07-02"), fill("c", "BUY", 6, 90, "2026-07-03")]));
  assert.deepEqual(ledger.rows.map(row => [row.action, row.afterQuantity]), [["回補",9],["加碼",15],["建倉",10]]);
});

test("reversal shows only the new cycle portion and proportional fee", () => {
  const data = { fills: [fill("a", "BUY", 10, 100, "2026-07-01"), fill("reverse", "SELL", 15, 110, "2026-07-02", { fee: 3, note: "反手依據" })], marketBars: [] };
  const {positions,cycles} = buildCycles(data);
  const row = buildPositionLedger(positions[0]).rows[0];
  assert.deepEqual([row.id,row.quantity,row.notional,row.fee,row.originalFillId,row.note],["reverse-open",5,550,1,"reverse","反手依據"]);
  assert.equal(row.eventId, "fill:reverse-open");
  assert.equal(cycles[0].fills.at(-1).fee + row.fee, 3);
});

test("past cycles and same symbol in another account never leak into active history", () => {
  const data = { fills: [fill("old", "BUY", 5, 10, "2026-07-01"), fill("exit", "SELL", 5, 11, "2026-07-02"), fill("new", "BUY", 2, 12, "2026-08-01"), fill("other", "BUY", 7, 13, "2026-08-01", {accountId:"b"})], marketBars: [] };
  const positions = buildCycles(data).positions;
  assert.deepEqual(positions.map(p => buildPositionLedger(p).rows.map(row => row.id)), [["new"],["other"]]);
});

test("same timestamp preserves source sequence and fractional shares reconcile", () => {
  const p = positionFor([fill("a", "BUY", .2, 100, "2026-08-01"), fill("b", "BUY", .1, 100, "2026-08-01"), fill("c", "SELL", .1, 100, "2026-08-01")]);
  const ledger = buildPositionLedger(p);
  assert.equal(ledger.hasSameDay, true);
  assert.deepEqual(ledger.rows.map(row => row.id), ["a","b","c"]);
  assert.equal(ledger.quantityMatches, true);
});

test("native currencies and account equity are unchanged by history projections", () => {
  const data = {fills: [fill("us", "BUY", 2, 100, "2026-08-01"), fill("tw", "SELL", 3, 1000, "2026-08-01", {accountId:"tw",symbol:"2330",currency:"TWD"})], marketBars: [], cashActivities:[{id:"usd",type:"DEPOSIT",amount:10000,currency:"USD",timestamp:"2026-07-01T00:00:00Z"}]};
  const now = new Date("2026-08-28T00:00:00Z");
  const before = JSON.stringify(data), equity = buildCurrentEquity(data, {}, 32, now);
  assert.deepEqual(buildCycles(data).positions.map(p => buildPositionLedger(p).rows[0].currency), ["USD","TWD"]);
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(buildCurrentEquity(data, {}, 32, now), equity);
});

test("missing legacy fill evidence is explicit and never synthesized", () => {
  const ledger = buildPositionLedger({id:"legacy",direction:"LONG",quantity:10,currency:"USD"});
  assert.equal(ledger.fillCount, 0);
  assert.equal(ledger.quantityMatches, false);
});

test("ledger event IDs focus the exact replay candle, including reversal IDs", () => {
  const position = positionFor([fill("a", "BUY", 10, 100, "2026-07-01"),fill("r", "SELL", 15, 110, "2026-07-02")]);
  const bars = [{symbol:"ORCL",date:"2026-07-02",open:110,high:120,low:105,close:115}];
  const replay = buildOpenPositionReplay(position, bars, [], {}, "2026-07-03");
  const target = replayFocus(replay, buildPositionLedger(position).rows[0].eventId);
  assert.equal(target.cursor, 0);
  assert.equal(target.event.quantity, 5);
  assert.equal(target.missingCandle, false);
});

test("missing exact-day candles retain event evidence without selecting a later candle", () => {
  const model = {events:[{id:"fill:a",date:"2026-08-01"}],candles:[{date:"2026-08-02"}]};
  assert.deepEqual(replayFocus(model,"fill:a"),{event:model.events[0],cursor:null,missingCandle:true});
  assert.deepEqual(replayFocus(model,"unknown"),{event:null,cursor:null,missingCandle:false});
  assert.equal(replayFocus({...model,candles:[{date:"2026-08-01"}]},"fill:a").cursor,0);
});
