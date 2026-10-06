import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCycles } from "../lib/trade-engine.mjs";

// Exercise actual TSX event handlers with a small deterministic hook harness.
// No account API, browser storage or new test framework is involved.
const require = createRequire(import.meta.url);
function harness() {
  let cursor = 0;
  const states = [], cache = new Map();
  const react = { ...React, useContext: () => null,
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
    useMemo: calculate => calculate(), useCallback: fn => fn, useEffect() {}, useRef: value => ({current:value}),
  };
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = new URL("../app/" + name + ".tsx", import.meta.url);
    let source = readFileSync(file, "utf8");
    if (name === "trade-workspace") source += "\nexport { PositionsPanel, TradeMetrics, CycleTable };";
    const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
    const componentModule = {exports:{}};
    new Function("require","module","exports",compiled)(id => {
      if (id === "react") return react;
      if (id.startsWith("./")) return load(id.slice(2));
      if (id.startsWith("@/lib/")) return require("../lib/" + id.slice(6));
      return require(id);
    },componentModule,componentModule.exports);
    cache.set(name,componentModule.exports);
    return componentModule.exports;
  }
  return {load,render(component,props) {cursor=0; return component(props);}};
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree,...nodes(tree.props?.children)];
}
const find = (tree,predicate) => nodes(tree).find(predicate);
const fill = (id,quantity,side="BUY") => ({id,accountId:"a",symbol:"ORCL",currency:"USD",side,quantity,price:100,fee:0,timestamp:`2026-08-0${id === "entry" ? 1 : 2}T00:00:00Z`});
const position = () => buildCycles({fills:[fill("entry",10),fill("reduce",4,"SELL")],marketBars:[]}).positions[0];
const propsFor = p => ({positions:[p],quotes:{},plans:{},accounts:[{id:"a",name:"測試帳戶",currency:"USD"}],totalAssetUsd:10000,fxRate:32,onPlanChange(){throw Error("must not edit plan");},onPlanCommit(){throw Error("must not commit plan");},onOpenChart(){}});

test("position disclosure toggles once, survives quote rerenders and retains grouped columns", () => {
  const h=harness(), Panel=h.load("trade-workspace").PositionsPanel, p=position();
  const props=propsFor(p);
  let tree=h.render(Panel,props);
  const toggle=find(tree,node=>node.props?.className === "position-ledger-toggle");
  assert.equal(toggle.props["aria-expanded"],false);
  assert.match(renderToStaticMarkup(tree),/colSpan="13"|colspan="13"/);
  toggle.props.onClick();
  tree=h.render(Panel,{...props,quotes:{ORCL:{price:105}}});
  assert.equal(find(tree,node=>node.props?.className === "position-ledger-toggle").props["aria-expanded"],true);
  const html=renderToStaticMarkup(tree);
  assert.match(html,/交易計畫與風險/);
  assert.match(html,/10 → <b>6<\/b> 股/);
  assert.match(html,/減碼/);
  find(tree,node=>node.props?.className === "position-ledger-toggle").props.onClick();
  tree=h.render(Panel,props);
  assert.equal(find(tree,node=>node.props?.className === "position-ledger-row").props.hidden,true);
});

test("expanded position follows stable cycle ID when quote ranking changes", () => {
  const h=harness(), Panel=h.load("trade-workspace").PositionsPanel,p=position();
  const other={...p,id:"cycle-other",symbol:"OTHER",quantity:1};
  const props={...propsFor(p),positions:[p,other]};
  const tree=h.render(Panel,props);
  find(tree,n=>n.props?.["aria-label"] === "ORCL 交易紀錄 2 筆").props.onClick();
  const updated=h.render(Panel,{...props,positions:[other,p],quotes:{ORCL:{price:1},OTHER:{price:10000}}});
  assert.equal(find(updated,n=>n.props?.["aria-label"] === "ORCL 交易紀錄 2 筆").props["aria-expanded"],true);
  assert.equal(find(updated,n=>n.props?.["aria-label"] === "OTHER 交易紀錄 2 筆").props["aria-expanded"],false);
});

test("ledger K-line action forwards exact cycle and fill event without changing source", () => {
  const h=harness(), Component=h.load("position-transactions").PositionTransactions.type,p=position();
  const before=JSON.stringify(p),calls=[];
  const tree=h.render(Component,{position:p,accountName:"測試",onOpenChart:(...args)=>calls.push(args)});
  find(tree,n=>n.type === "button").props.onClick();
  assert.deepEqual(calls,[[p,"fill:reduce"]]);
  assert.equal(JSON.stringify(p),before);
  assert.match(renderToStaticMarkup(tree),/成交金額＝數量 × 成交價（未含費用）/);
});

test("replay initializes exact fill selection and moves cursor when daily data arrives", () => {
  const h=harness(), Replay=h.load("training-workspace").ReplayBoard,p=position();
  const props={cycle:{...p,status:"OPEN"},marketBars:[],planHistory:[],review:{},rapidPairs:[],decisionLinks:{},onAddPlanVersion(){}};
  let html=renderToStaticMarkup(h.render(Replay,{...props,initialEventId:"fill:reduce"}));
  assert.match(html,/缺少該日日K/);
  assert.match(html,/部位 10 → 6/);
  const marketBars=[{symbol:"ORCL",date:"2026-08-01",close:100},{symbol:"ORCL",date:"2026-08-02",close:105},{symbol:"ORCL",date:"2026-08-03",close:104}];
  html=renderToStaticMarkup(h.render(Replay,{...props,marketBars,initialEventId:"fill:reduce"}));
  assert.doesNotMatch(html,/缺少該日日K/);
  assert.match(html,/重播至 2026-08-02/);
  assert.match(html,/aria-label="交易重播日期"[^>]*value="1"/);
});

test("empty history shows a limitation, no fake fills or edit actions", () => {
  const h=harness(),Component=h.load("position-transactions").PositionTransactions.type;
  const html=renderToStaticMarkup(h.render(Component,{position:{...position(),fills:[]},accountName:"測試",onOpenChart(){}}));
  assert.match(html,/沒有可用的原始成交明細/);
  assert.doesNotMatch(html,/定位成交|刪除|<input/);
});

const metricCycle=(id,date,pnl)=>({id,symbol:id,direction:"LONG",currency:"USD",openAt:"2026-01-01",closeAt:date,averageEntry:100,averageExit:100+pnl,holdingDays:2,pnl,returnPct:pnl/100,maePct:null,mfePct:null,quality:"缺行情"});
const metricProps=()=>({cycles:[metricCycle("JUL","2026-07-31T23:00:00Z",20),metricCycle("AUG","2026-08-10T00:00:00Z",10),metricCycle("LOSS","2026-08-20T00:00:00Z",-5)],monthKey:"2026-08",fxRate:32,onSelect(){}});
const scoreNode=tree=>find(tree,n=>n.type?.name==="MonthScorecard");
const cycleNode=tree=>find(tree,n=>n.type?.name==="CycleTable");

test("overview metrics offer only cumulative, year and month with current month selected by default",()=>{
 const h=harness(),Component=h.load("trade-workspace").TradeMetrics,props=metricProps();
 props.cycles.push(metricCycle("OLD","2025-12-31T23:59:59Z",50));
 let tree=h.render(Component,props);
 const selector=find(tree,n=>n.props?.["aria-label"]==="交易計量資料區間");
 assert.equal(selector.props.value,"month");
 assert.deepEqual(selector.props.children.map(option=>[option.props.value,option.props.children]),[["all","總累積"],["year","年"],["month","月"]]);
 assert.equal(find(tree,n=>n.props?.["aria-label"]==="交易計量月份").props.value,"2026-08");
 assert.doesNotMatch(renderToStaticMarkup(tree),/自訂日期|開始日期|結束日期|上月/);
 assert.equal(scoreNode(tree).props.score.totalPnlUsd,5);
 assert.equal(cycleNode(tree).props.cycles,scoreNode(tree).props.score.cycles);
 for(const [preset,count,total] of [["year",3,25],["all",4,75],["month",2,5]]){
  find(tree,n=>n.type==="select").props.onChange({target:{value:preset}});
  tree=h.render(Component,props);
  assert.equal(scoreNode(tree).props.score.cycles.length,count);
  assert.equal(scoreNode(tree).props.score.totalPnlUsd,total);
  assert.equal(cycleNode(tree).props.cycles,scoreNode(tree).props.score.cycles);
 }
});

test("selected month remains stable on refresh and invalid months hide misleading results",()=>{
 const h=harness(),Component=h.load("trade-workspace").TradeMetrics,props=metricProps();let tree=h.render(Component,props);
 find(tree,n=>n.props?.["aria-label"]==="交易計量月份").props.onChange({target:{value:"2026-07"}});
 tree=h.render(Component,{...props,fxRate:null});assert.equal(scoreNode(tree).props.score.cycles.length,1);
 tree=h.render(Component,{...props,monthKey:"2026-09"});assert.equal(scoreNode(tree).props.score.totalPnlUsd,20);
 assert.equal(cycleNode(tree).props.cycles,scoreNode(tree).props.score.cycles);
 for(const invalid of ["","2026-13"]){
  find(tree,n=>n.props?.["aria-label"]==="交易計量月份").props.onChange({target:{value:invalid}});
  tree=h.render(Component,props);assert.match(renderToStaticMarkup(tree),/請選擇有效的月份/);assert.equal(scoreNode(tree),undefined);assert.equal(cycleNode(tree),undefined);
 }
});

test("historical year selection filters both score and cycles and survives scope changes",()=>{
 const h=harness(),Component=h.load("trade-workspace").TradeMetrics,props=metricProps();
 props.cycles.push(metricCycle("OLD","2025-12-31T23:59:59Z",50));
 let tree=h.render(Component,props);
 find(tree,n=>n.props?.["aria-label"]==="交易計量資料區間").props.onChange({target:{value:"year"}});
 tree=h.render(Component,props);
 const years=find(tree,n=>n.props?.["aria-label"]==="交易計量年份");
 assert.deepEqual(years.props.children.map(option=>option.props.value),["2026","2025"]);
 years.props.onChange({target:{value:"2025"}});
 tree=h.render(Component,{...props,monthKey:"2027-01"});
 assert.equal(scoreNode(tree).props.score.totalPnlUsd,50);
 assert.deepEqual(cycleNode(tree).props.cycles.map(c=>c.id),["OLD"]);
 find(tree,n=>n.props?.["aria-label"]==="交易計量資料區間").props.onChange({target:{value:"all"}});
 tree=h.render(Component,props);assert.equal(find(tree,n=>n.props?.["aria-label"]==="交易計量年份"),undefined);assert.equal(find(tree,n=>n.type==="input"),undefined);
 assert.equal(scoreNode(tree).props.score.totalPnlUsd,75);
 find(tree,n=>n.props?.["aria-label"]==="交易計量資料區間").props.onChange({target:{value:"year"}});
 tree=h.render(Component,props);assert.equal(find(tree,n=>n.props?.["aria-label"]==="交易計量年份").props.value,"2025");
});

test("current month rolls forward, leap February is valid, and an empty period stays selected",()=>{
 const h=harness(),Component=h.load("trade-workspace").TradeMetrics,props=metricProps();
 props.cycles.push(metricCycle("LEAP","2024-02-29T23:59:59Z",100),metricCycle("MARCH","2024-03-01T00:00:00Z",200));
 let tree=h.render(Component,{...props,monthKey:"2024-02"});
 assert.equal(find(tree,n=>n.props?.["aria-label"]==="交易計量月份").props.value,"2024-02");
 assert.deepEqual(cycleNode(tree).props.cycles.map(c=>c.id),["LEAP"]);
 tree=h.render(Component,{...props,monthKey:"2026-09"});
 assert.equal(find(tree,n=>n.props?.["aria-label"]==="交易計量月份").props.value,"2026-09");
 assert.equal(scoreNode(tree).props.score.cycles.length,0);
 assert.match(renderToStaticMarkup(tree),/尚未形成完整交易閉環/);
 assert.equal(scoreNode(tree).props.score.winRate,null);
});

test("metric evidence opens the same original cycle for replay and review",()=>{
 const h=harness(),Component=h.load("trade-workspace").TradeMetrics,props=metricProps(),selected=[];
 const tree=h.render(Component,{...props,onSelect:cycle=>selected.push(cycle)});
 const table=cycleNode(tree),rendered=table.type(table.props);
 find(rendered,n=>n.type==="button"&&n.props.children==="詳情").props.onClick();
 assert.equal(selected[0],props.cycles[2]);
});

test("overview disclosures mount lazily and preserve their children after collapsing",()=>{
 const h=harness(),Component=h.load("workspace-ui").OverviewDisclosure;
 const child=React.createElement("input",{value:"unchanged plan",readOnly:true}),props={id:"plans",label:"全部持倉與計畫編輯",children:child};
 let tree=h.render(Component,props);assert.equal(tree.type,"details");assert.equal(tree.props.open,undefined);assert.doesNotMatch(renderToStaticMarkup(tree),/unchanged plan/);
 tree.props.onToggle({currentTarget:{open:true}});tree=h.render(Component,props);
 assert.equal(find(tree,n=>n.props?.id==="plans").props.children,child);
 tree.props.onToggle({currentTarget:{open:false}});tree=h.render(Component,props);
 assert.equal(find(tree,n=>n.props?.id==="plans").props.children,child);
 assert.match(renderToStaticMarkup(tree),/aria-controls="plans"/);
});

test("holdings prices are read-only and retain the K-line entry",()=>{
 const h=harness(),Component=h.load("trade-workspace").PositionsPanel,p=position(),calls=[];
 const props={...propsFor(p),onOpenChart:(...args)=>calls.push(args)};
 const tree=h.render(Component,props);
 assert.equal(find(tree,n=>n.type==="input"),undefined);
 find(tree,n=>n.type==="button"&&n.props.children==="看進場與停損K線").props.onClick();assert.deepEqual(calls,[[p]]);
 const updated=h.render(Component,{...props,plans:{[p.id]:{stopLoss:90,takeProfit:150,note:"新計畫"}}});
 assert.match(renderToStaticMarkup(updated),/90.0/);assert.match(renderToStaticMarkup(updated),/150.0/);
});


test("cycle table defaults to latest exit and all data headers toggle sorting",()=>{
 const h=harness(),Table=h.load('trade-workspace').CycleTable,props={cycles:metricProps().cycles,title:'全部交易閉環'};
 const symbols=tree=>nodes(tree).filter(n=>n.type==='tbody').flatMap(n=>n.props.children.map(row=>row.props.children[0].props.children.props.children));
 let tree=h.render(Table,props);assert.deepEqual(symbols(tree),['LOSS','AUG','JUL']);
 const headers=nodes(tree).filter(n=>n.type==='th'&&n.props['aria-sort']);assert.equal(headers.length,11);
 for(const header of headers){
  header.props.children.props.onClick();tree=h.render(Table,props);
  const active=nodes(tree).find(n=>n.type==='th'&&n.props['aria-sort']==='ascending');assert.ok(active);
  active.props.children.props.onClick();tree=h.render(Table,props);assert.ok(nodes(tree).some(n=>n.type==='th'&&n.props['aria-sort']==='descending'));
 }
 const profit=nodes(tree).find(n=>n.type==='button'&&n.props['aria-label']?.startsWith('損益，'));profit.props.onClick();tree=h.render(Table,props);assert.deepEqual(symbols(tree),['LOSS','AUG','JUL']);
 assert.deepEqual(props.cycles.map(c=>c.symbol),['JUL','AUG','LOSS']);
});
