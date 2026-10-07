import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCurrentEquity } from "../lib/portfolio-engine.mjs";

const at = new Date("2026-08-28T00:00:00Z");
const cash = (amount, currency="USD", type="DEPOSIT", timestamp="2026-08-01T00:00:00Z") => ({id:"cash",amount,currency,type,timestamp});
const fill = (id, side, quantity, price, extra={}) => ({id,accountId:"main",symbol:id,currency:"USD",side,quantity,price,fee:0,timestamp:"2026-08-02T00:00:00Z",...extra});
const equity = (fills=[],cashActivities=[cash(1000)],quotes={},rate=32,marketBars=[]) => buildCurrentEquity({fills,cashActivities,marketBars},quotes,rate,at);

test("cash and long market value sum to unchanged equity; exposure uses current price", () => {
  const e=equity([fill("AAA","BUY",2,100,{fee:2})],undefined,{AAA:{price:120}});
  assert.equal(e.cashUsd,798);
  assert.equal(e.grossPositionValueUsd,240);
  assert.equal(e.totalUsd,1038);
  assert.equal(e.exposurePct,240/1038);
  assert.equal(e.hasShortPositions,false);
});
test("mixed currency cash and positions use the same exchange rate", () => {
  const e=equity([fill("TW","BUY",10,320,{currency:"TWD"})],[cash(1000),cash(6400,"TWD")],{TW:{price:352}});
  assert.equal(e.cashUsd,1100);
  assert.equal(e.grossPositionValueUsd,110);
  assert.equal(e.totalUsd,1210);
  assert.equal(e.exposurePct,110/1210);
});
test("short exposure is absolute while net assets deduct the liability", () => {
  const e=equity([fill("LONG","BUY",2,100),fill("SHORT","SELL",3,100)],undefined,{LONG:{price:120},SHORT:{price:90}});
  assert.equal(e.cashUsd,1100);
  assert.equal(e.longPositionValueUsd,240);
  assert.equal(e.shortPositionValueUsd,270);
  assert.equal(e.grossPositionValueUsd,510);
  assert.equal(e.totalUsd,1070);
  assert.equal(e.exposurePct,510/1070);
  assert.equal(e.hasShortPositions,true);
});
test("same symbol in different accounts cannot cancel gross exposure", () => {
  const e=equity([fill("AAA","BUY",2,100),fill("AAA","SELL",2,100,{accountId:"other"})]);
  assert.equal(e.totalUsd,1000);
  assert.equal(e.grossPositionValueUsd,400);
  assert.equal(e.exposurePct,.4);
});
test("negative cash and leveraged exposure remain visible above 100 percent", () => {
  const e=equity([fill("AAA","BUY",15,100)]);
  assert.equal(e.cashUsd,-500);
  assert.equal(e.totalUsd,1000);
  assert.equal(e.exposurePct,1.5);
});
test("cash balance cutoff and withdrawal adjustments retain original semantics", () => {
  const e=equity([fill("AAA","BUY",2,100,{timestamp:"2026-07-01T00:00:00Z"})],[cash(800,"USD","OPENING_BALANCE"),{...cash(100,"USD","WITHDRAWAL"),id:"adjust"}]);
  assert.equal(e.cashUsd,700);
  assert.equal(e.totalUsd,900);
  assert.equal(e.grossPositionValueUsd,200);
});
test("no holdings yield zero exposure; zero or negative equity cannot define a ratio", () => {
  assert.equal(equity().exposurePct,0);
  assert.equal(equity().grossPositionValueUsd,0);
  assert.equal(equity([],[]).exposurePct,null);
  assert.equal(equity([],[cash(-100)]).exposurePct,null);
});
test("missing FX or valuation never produces a fabricated exposure percentage", () => {
  const fxMissing=equity([fill("TW","BUY",1,320,{currency:"TWD"})],[cash(640,"TWD")],{},null);
  assert.equal(fxMissing.cashUsd,null);
  assert.equal(fxMissing.grossPositionValueUsd,null);
  assert.equal(fxMissing.exposurePct,null);
  const missing=equity([fill("AAA","BUY",1,NaN)]);
  assert.equal(missing.grossPositionValueUsd,null);
  assert.equal(missing.exposurePct,null);
});
test("fallback valuations match total assets when live quote is absent", () => {
  const e=equity([fill("AAA","BUY",2,100)],undefined,{},32,[{symbol:"AAA",date:"2026-08-20",close:125}]);
  assert.equal(e.grossPositionValueUsd,250);
  assert.equal(e.cashUsd+e.grossPositionValueUsd,e.totalUsd);
  assert.equal(e.liveQuoteCount,0);
});

const require=createRequire(import.meta.url);
const source=readFileSync(new URL("../app/equity-breakdown.tsx",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const componentModule={exports:{}};
new Function("require","module","exports",compiled)(id=>id==='./valuation-context'?{useValuation:()=>({currency:'USD',formatUsd:v=>v==null?'—':`USD ${v.toFixed(2)}`,format:v=>v==null?'—':`USD ${v.toFixed(2)}`})}:require(id),componentModule,componentModule.exports);
const render = e => renderToStaticMarkup(React.createElement(componentModule.exports.EquityBreakdown,{equity:e}));
test("overview breakdown renders separate USD balances and exposure formula", () => {
  const html=render(equity([fill("AAA","BUY",2,100)]));
  assert.match(html,/現金水位/); assert.match(html,/持倉水位/);
  assert.match(html,/USD(?:\s|&#xA0;|&nbsp;)800\.0/);
  assert.match(html,/持倉／總資產/); assert.match(html,/20.0%/);
  assert.doesNotMatch(html,/個持倉使用即時報價|現金＋即時持倉/);
  const workspace=readFileSync(new URL("../app/trade-workspace.tsx",import.meta.url),"utf8");
  assert.match(workspace,/<EquityBreakdown equity=\{currentEquity\}/);
  assert.doesNotMatch(workspace,/個持倉使用即時報價/);
});
test("breakdown explains shorts and shows unavailable ratios as dash", () => {
  assert.match(render(equity([fill("AAA","SELL",2,100)])),/空單市值絕對值/);
  assert.match(render(equity()),/0.0%/);
  const empty=render(equity([],[]));
  assert.match(empty,/曝險比率.*<dd>—<\/dd>/);
  assert.match(empty,/總資產未大於零/);
  assert.match(render(equity([fill("AAA","BUY",15,100)])),/150.0%/);
});
