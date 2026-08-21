import test from "node:test";
import assert from "node:assert/strict";
import { classifyCashActivities, importTraderX2Csv } from "../lib/trader-x2-importer.mjs";

const csv = `Symbol,Side,Qty,Fill Price,Commission,Closing Time
NASDAQ:AMZN,Buy,80,264.63,0,2026-08-19 16:38:02
TPEX:3675,Sell,4000,274,3,2026-08-18 05:24:00
$CASH,Deposit,650,,,2026-08-14 19:59:00`;

test("Trader X2 CSV maps market and symbol", () => { const data = importTraderX2Csv(csv); assert.equal(data.fills[0].market, "NASDAQ"); assert.equal(data.fills[0].symbol, "AMZN"); });
test("Trader X2 side and numbers are typed", () => { const fill = importTraderX2Csv(csv).fills[1]; assert.equal(fill.side, "SELL"); assert.equal(fill.quantity, 4000); assert.equal(fill.price, 274); assert.equal(fill.fee, 3); });
test("Taiwan trades use TWD account", () => { const fill = importTraderX2Csv(csv).fills[1]; assert.equal(fill.currency, "TWD"); assert.equal(fill.accountId, "trader-x2-twd"); });
test("source timestamps remain UTC", () => assert.equal(importTraderX2Csv(csv).fills[0].timestamp, "2026-08-19T16:38:02Z"));
test("cash deposits are preserved outside fills", () => { const data = importTraderX2Csv(csv); assert.equal(data.fills.length, 2); assert.equal(data.cashActivities[0].amount, 650); assert.equal(data.cashActivities[0].requiresReview, true); });
test("missing required columns fail closed", () => assert.throws(() => importTraderX2Csv("Symbol,Qty\nAAPL,1"), /缺少必要欄位/));
test("cash activities can be classified after user confirmation", () => { const data = classifyCashActivities(importTraderX2Csv(csv), { currency: "USD", accountId: "trader-x2-usd" }); assert.equal(data.cashActivities[0].currency, "USD"); assert.equal(data.cashActivities[0].requiresReview, false); });
