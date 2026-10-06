import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { buildTradeSnapshot } from "../lib/trade-snapshot.mjs";
import { completeTradeJson } from "../lib/trade-record-store.mjs";
import { previewEntry } from "../lib/trade-entry.mjs";

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL("../app/trade-workspace.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const stamp = "2026-08-27T00:00:00Z";
const source = () => buildTradeSnapshot({ version: "1", profile: { name: "測試帳號", baseCurrency: "USD", costMethod: "FIFO" }, accounts: [{ id: "main", currency: "USD" }], fills: [{ id: "buy", accountId: "main", symbol: "AAA", market: "NASDAQ", currency: "USD", side: "BUY", quantity: 10, price: 10, fee: 0, timestamp: "2026-08-01T00:00:00Z" }], cashActivities: [{ id: "deposit", type: "DEPOSIT", accountId: "main", currency: "USD", amount: 1000, timestamp: "2026-08-01T00:00:00Z" }], marketBars: [{ symbol: "AAA", date: "2026-08-26", open: 10, high: 13, low: 9, close: 12, volume: 1000 }], settings: { benchmarkSymbol: "SPY" }, strategies: [], strategyAssignments: {}, cycleReviews: {}, positionPlans: { "cycle-buy": { stopLoss: 9, note: "原始計畫" } }, planHistory: [], improvementExperiments: [], decisionLinks: {}, decisionLinkHistory: [] }, { quotes: { AAA: { symbol: "AAA", price: 12, updatedAt: stamp }, "USDTWD=X": { symbol: "USDTWD=X", price: 32, updatedAt: stamp } }, lastQuoteAt: Date.parse(stamp), benchmarkSymbol: "SPY", benchmarkBars: [{ symbol: "SPY", date: "2026-08-26", close: 600 }] });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== "object" ? [] : [tree, ...nodes(tree.props?.children)];
const find = (tree, fn) => nodes(tree).find(fn);

// Run the real component's hooks and event handlers; no browser, DOM or account writes.
function harness(initial = source(), values = new Map()) {
  let stored = structuredClone(initial), version = 1, index = 0, dirty = true, tree, serial = 0, onlineMarkets = false, failWrites = false;
  const hooks = [], effects = [], timers = new Map(), writes = [], events = new Map();
  const storage = { getItem: k => values.get(k) || null, setItem: (k,v) => values.set(k,v) };
  const timer = (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; };
  const window = { setTimeout: timer, clearTimeout: id => timers.delete(id), setInterval: (fn,ms)=>{const id=timer(fn,ms);timers.get(id).interval=true;return id;}, clearInterval: id => timers.delete(id), addEventListener: (name, fn) => events.set(name,fn), removeEventListener: name => events.delete(name), scrollTo() {} };
  const react = { ...React, startTransition: fn => fn(),
    useState(initialValue) { const i = index++; if (!(i in hooks)) hooks[i] = typeof initialValue === "function" ? initialValue() : initialValue; return [hooks[i], value => { const next = typeof value === "function" ? value(hooks[i]) : value; if (!Object.is(next,hooks[i])) { hooks[i] = next; dirty = true; } }]; },
    useRef(initialValue) { const i = index++; return hooks[i] ||= { current: initialValue }; },
    useMemo(fn,deps) { const i=index++; if (!hooks[i] || deps.some((d,j) => !Object.is(d,hooks[i].deps[j]))) hooks[i]={ value:fn(), deps }; return hooks[i].value; },
    useCallback(fn,deps) { return react.useMemo(() => fn,deps); },
    useEffect(fn,deps) { const i=index++; if (!hooks[i] || deps.some((d,j) => !Object.is(d,hooks[i].deps[j]))) { const previous=hooks[i]; hooks[i]={deps}; effects.push(() => { previous?.cleanup?.(); hooks[i].cleanup=fn(); }); } },
  };
  const fetcher = async (url, options={}) => {
    const account = { id:"primary", name:"測試帳號", version, updatedAt:stamp };
    const response = (status,payload) => ({ ok:status===200, status, json:async () => payload });
    if (url === "/api/trade-records" && options.method === "PUT") {
      if (failWrites) return response(503,{error:"測試磁碟不可用"});
      const payload=JSON.parse(options.body); writes.push(payload);
      if (payload.baseVersion !== version) return response(409,{});
      stored=payload.dataset;version++;return response(200,{account:{...account,version}});
    }
    if (url === "/api/trade-records") return response(200,{account,dataset:structuredClone(stored),accounts:[account]});
    if (url.startsWith("/api/trade-records?")) return response(200,{account,dataset:structuredClone(stored)});
    if (onlineMarkets && url.startsWith("/api/quotes")) return response(200,{quotes:[{symbol:"AAA",price:15,updatedAt:"2026-08-28T00:00:00Z"}],errors:[]});
    return response(503,{error:"離線測試"});
  };
  const componentModule = {exports:{}};
  new Function("require","module","exports","window","document","localStorage","fetch","setTimeout","clearTimeout",code)(id => {
    if (id === "react") return react;
    if (id.startsWith("./")) return new Proxy({}, {get:(_,name) => { const fn=()=>null; Object.defineProperty(fn,"name",{value:name}); return fn; }});
    if (id.startsWith("@/lib/")) {
      const actual=require("../lib/"+id.slice(6));
      return id.endsWith("trade-record-client.mjs") ? {...actual,browserRecordStorage:()=>storage,saveTradeRecord:args=>actual.saveTradeRecord({...args,fetcher})} : actual;
    }
    return require(id);
  },componentModule,componentModule.exports,window,{getElementById:()=>null},storage,fetcher,timer,window.clearTimeout);
  function render() { index=0;dirty=false;tree=componentModule.exports.default({user:{id:"fixture-user",email:"fixture@example.test",name:"測試帳號",isOwner:true,sessionId:"fixture-session",expiresAt:"2099-01-01T00:00:00Z"}}); for(const effect of effects.splice(0)) effect();return tree; }
  return {
    render, get tree(){return tree;},get stored(){return stored;}, writes,events,values,
    async settle(){ for(let i=0;i<15;i++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));}return tree; },
    runTimers(ms){ for(const [id,task] of [...timers]) if(task.ms===ms){if(!task.interval)timers.delete(id);task.fn();} },
    set online(value){onlineMarkets=value;},set fail(value){failWrites=value;},
    close(){for(const hook of hooks)hook?.cleanup?.();},
  };
}
const navigate = (h,page) => { find(h.tree,n=>n.type?.name==="WorkspaceNavigation").props.onNavigate(page); h.render(); };
const manual = h => { navigate(h,"ledgers"); return find(h.tree,n => n.type === "button" && ["立即儲存","儲存中…"].includes(n.props.children)); };

test("homepage manual button waits for full write, prevents duplicates, and restored evidence survives offline", async t => {
  const h=harness();t.after(()=>h.close());h.render();assert.equal(manual(h).props.disabled,true);
  await h.settle();assert.equal(manual(h).props.disabled,false);
  const click=manual(h).props.onClick;click();click();h.render();assert.equal(manual(h).props.children,"儲存中…");
  await h.settle();assert.equal(h.writes.length,1);assert.equal(h.writes[0].saveMode,"manual");
  assert.deepEqual(h.stored.marketBars,source().marketBars);
  assert.deepEqual(h.stored.marketSnapshot,source().marketSnapshot);
  assert.deepEqual(h.stored.positionPlans,source().positionPlans);
  assert.ok(nodes(h.tree).some(n=>n.props?.role==="status"&&JSON.stringify(n.props.children).includes("雲端已儲存（手動）")));
  const restarted=harness(JSON.parse(completeTradeJson(h.stored)));t.after(()=>restarted.close());await restarted.settle();
  manual(restarted).props.onClick();await restarted.settle();assert.deepEqual(restarted.stored,h.stored);
});

test("price-only updates and explicit plan saves persist complete snapshots through the same queue", async t => {
  const h=harness();t.after(()=>h.close());await h.settle();h.runTimers(600_000);await h.settle();
  h.online=true;h.runTimers(30_000);await h.settle();const before=h.writes.length;h.runTimers(900);await h.settle();assert.equal(h.writes.length,before,"quote changes must wait for ten-minute clock");h.runTimers(600_000);await h.settle();
  assert.equal(h.writes.at(-1).saveMode,"auto");assert.equal(h.stored.marketSnapshot.quotes.AAA.price,15);
  assert.equal(h.stored.marketSnapshot.quotes["USDTWD=X"].price,32,"failed refresh must not remove FX");
  navigate(h,"overview");await h.settle();
  const panel=find(h.tree,n=>n.type?.name==="PositionsPanel");
  panel.props.onOpenChart(panel.props.positions[0]);await h.settle();
  await find(h.tree,n=>n.type?.name==="OpenPositionDetail").props.onSavePlan(panel.props.positions[0],{note:"新的持倉計畫"},"test-plan-batch");
  await h.settle();h.runTimers(600_000);await h.settle();
  assert.ok(Object.values(h.stored.positionPlans).some(p=>p.note==="新的持倉計畫"));
  assert.deepEqual(h.stored.marketBars,source().marketBars);
  const event={preventDefault(){this.warned=true;}};h.events.get("beforeunload")(event);assert.equal(event.warned,undefined);
});

test("failed manual write never reports success or removes the current data", async t => {
  const h=harness();t.after(()=>h.close());await h.settle();h.fail=true;
  manual(h).props.onClick();await h.settle();assert.equal(manual(h).props.children,"立即儲存");
  assert.ok(nodes(h.tree).some(n=>n.props?.role==="status"&&JSON.stringify(n.props.children).includes("等待重試")));
  assert.equal(h.writes.length,0);assert.deepEqual(h.stored,source());
});

test("new registration page saves a no-impact account draft, commits atomically and reopens full evidence", async t => {
  const h=harness();t.after(()=>h.close());await h.settle();
  find(h.tree,n=>n.type==="button"&&n.props.children==="新增交易").props.onClick();await h.settle();
  const entry=()=>find(h.tree,n=>n.type?.name==="TradeEntryWorkspace");
  assert.ok(entry(),"workspace page replaces old modal");
  entry().props.onChange({symbol:"AAA",quantity:"2",price:"13",timestamp:new Date(Date.now()-60000).toISOString(),entrySetup:"PULLBACK",volumeTags:["SUPPORT_RETEST"],addReason:"RETEST",stopLoss:"10",takeProfit:"18",note:"回測後加碼"});
  await h.settle();h.runTimers(600_000);await h.settle();
  assert.equal(h.stored.fills.length,1);assert.equal(h.stored.entryDraft.note,"回測後加碼");
  const current=entry().props,preview=previewEntry(current.data,current.draft);
  current.onChange({confirmedKey:preview.confirmationKey});await h.settle();entry().props.onSubmit();await h.settle();
  assert.equal(entry(),undefined);
  manual(h).props.onClick();await h.settle();
  assert.equal(h.stored.fills.length,2);assert.equal(h.stored.entryDraft,undefined);
  const context=Object.values(h.stored.entryContexts)[0];assert.equal(context.action,"ADD");assert.equal(context.entrySetup,"PULLBACK");assert.deepEqual(context.volumeTags,["SUPPORT_RETEST"]);assert.equal(h.stored.planHistory.length,2);
  const restarted=harness(JSON.parse(completeTradeJson(h.stored)));t.after(()=>restarted.close());await restarted.settle();manual(restarted).props.onClick();await restarted.settle();assert.deepEqual(restarted.stored.entryContexts,h.stored.entryContexts);
});

test('cached plan releases form during network failure and retries without duplicate history',async t=>{
 const h=harness();t.after(()=>h.close());await h.settle();
 navigate(h,"overview");await h.settle();
 const panel=find(h.tree,n=>n.type?.name==='PositionsPanel'),p=panel.props.positions[0];panel.props.onOpenChart(p);await h.settle();
 h.fail=true;await find(h.tree,n=>n.type?.name==='OpenPositionDetail').props.onSavePlan(p,{stopLoss:12,takeProfit:20},'retry-batch');await h.settle();assert.ok(!h.stored.planHistory?.some(v=>v.batchId==='retry-batch'));
 h.fail=false;await find(h.tree,n=>n.type?.name==='OpenPositionDetail').props.onSavePlan(p,{stopLoss:12,takeProfit:20},'retry-batch');await h.settle();
 assert.equal(h.stored.planHistory.filter(v=>v.batchId==='retry-batch').length,2);assert.deepEqual(h.stored.fills,source().fills);
});


test('locally saved plan survives reload before cloud acknowledgement',async t=>{
 const h=harness();t.after(()=>h.close());await h.settle();
 navigate(h,"overview");await h.settle();
 const panel=find(h.tree,n=>n.type?.name==='PositionsPanel'),position=panel.props.positions[0];
 panel.props.onOpenChart(position);await h.settle();h.fail=true;
 await find(h.tree,n=>n.type?.name==='OpenPositionDetail').props.onSavePlan(position,{stopLoss:8,note:'cached offline'},'local-reload');
 await h.settle();assert.equal(h.writes.length,0);
 const restored=harness(source(),h.values);t.after(()=>restored.close());await restored.settle();
 manual(restored).props.onClick();await restored.settle();
 assert.ok(Object.values(restored.stored.positionPlans).some(p=>p.note==='cached offline'));
 assert.equal(restored.stored.planHistory.filter(p=>p.batchId==='local-reload'&&p.field==='stopLoss').length,1);
});

test('holdings palette defaults green-up, updates both displays and restores from cache and cloud',async t=>{
 const h=harness();t.after(()=>h.close());await h.settle();
 navigate(h,"overview");await h.settle();
 const choose=(scope,label)=>find(scope.tree,n=>n.type==='button'&&n.props.children===label);
 assert.equal(choose(h,'綠漲紅跌').props['aria-pressed'],true);
 choose(h,'紅漲綠跌').props.onClick();await h.settle();
 assert.equal(find(h.tree,n=>n.props?.id==='overview-holdings').props['data-holdings-colors'],'red-up');
 assert.equal(find(h.tree,n=>n.type?.name==='HoldingsHeatmap').props.colorScheme,'red-up');
 assert.equal(h.writes.length,0);
 const restored=harness(source(),h.values);t.after(()=>restored.close());await restored.settle();
 manual(restored).props.onClick();await restored.settle();
 assert.equal(restored.stored.settings.holdingsColorScheme,'red-up');
 assert.deepEqual(restored.stored.fills,source().fills);
 const fresh=harness(restored.stored);t.after(()=>fresh.close());await fresh.settle();
 navigate(fresh,"overview");await fresh.settle();
 assert.equal(choose(fresh,'紅漲綠跌').props['aria-pressed'],true);
});

test('repeated authentication failures and unload cannot overwrite the preserved ledger with cleared UI state', async t => {
 const h=harness();t.after(()=>h.close());await h.settle();
 const oldUnload=h.events.get('pagehide');
 const changed=h.events.get('storage');
 changed({key:'tg.auth.changed',newValue:'another-session'});await h.settle();
 const backups=[...h.values].filter(([key])=>key.endsWith('.pending'));
 assert.ok(backups.length>0);
 for(const [,value] of backups)assert.equal(JSON.parse(JSON.parse(value).serialized).fills.length,1);
 changed({key:'tg.auth.changed',newValue:'another-session'});oldUnload();await h.settle();
 for(const [key,value] of backups)assert.equal(h.values.get(key),value);
 h.runTimers(600_000);await h.settle();assert.equal(h.writes.length,0);
});
