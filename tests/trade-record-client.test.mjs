import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { durableTradeJson, validateTradeRecordPayload } from "../lib/trade-record-store.mjs";
import { canRefreshCloudRecord, createRecordSaveQueue, saveTradeRecord } from "../lib/trade-record-client.mjs";

const data = () => ({ profile: { name: "帳號" }, accounts: [], fills: [], marketBars: [], settings: {} });
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });
const account = version => ({ id: "primary", name: "帳號", version, updatedAt: "2026-08-28T00:00:00Z" });


test("complete snapshots retain market evidence; emergency journals stay small; limits use UTF8 bytes", () => {
  const d = { ...data(), marketBars: [{ cache: "x".repeat(3_200_000) }], positionPlans: { one: { stopLoss: 5 } }, planHistory: [1], cycleReviews: { one: { entryQualityTag: "IDEAL" } }, strategies: [1], strategyAssignments: { one: 1 }, improvementExperiments: [1], extraUserField: "keep" };
  const checked = validateTradeRecordPayload({ accountId: "primary", accountName: "帳號", dataset: d }, { maxBytes: 50_000_000 });
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.dataset, d);
  assert.deepEqual(JSON.parse(durableTradeJson(d)), { ...d, marketBars: [] });
  assert.equal(validateTradeRecordPayload({ accountId: "primary", accountName: "帳號", dataset: d }).ok, false, "D1 must reject, never silently discard evidence");
  assert.equal(d.marketBars[0].cache.length, 3_200_000);
  assert.equal(validateTradeRecordPayload({ accountId: "primary", accountName: "帳號", dataset: { ...data(), note: "中".repeat(650_000) } }).ok, false);
});

test("save sends compact data and reconciles a committed request whose response was lost", async () => {
  const baselineJson = durableTradeJson(data()), serialized = durableTradeJson({ ...data(), strategies: [1] }), calls = [];
  const saved = await saveTradeRecord({ accountId: "primary", accountName: "帳號", baseVersion: 1, baselineJson, serialized, fetcher: async (url, options) => {
    calls.push(options.method);
    if (options.method === "PUT") { assert.equal(JSON.parse(options.body).dataset.marketBars.length, 0); return response(409, {}); }
    return response(200, { account: account(2), dataset: JSON.parse(serialized) });
  } });
  assert.equal(saved.account.version, 2);
  assert.deepEqual(calls, ["PUT", "GET"]);
});

test("conflicting edits never retry against a newer version", async () => {
  let writes = 0;
  await assert.rejects(saveTradeRecord({ accountId: "primary", accountName: "帳號", baseVersion: 1, baselineJson: durableTradeJson(data()), serialized: durableTradeJson({ ...data(), cycleReviews: {other:{note:"local"}} }), fetcher: async (url, options) => {
    if (options.method === "PUT") { writes++; return response(409, {}); }
    return response(200, { account: account(2), dataset: { ...data(), cycleReviews: { other: {} } } });
  } }), e => e.status === 409 && !e.retryable);
  assert.equal(writes, 1);
});

test("offline saves establish a baseline and transient failures remain retryable", async () => {
  const saved = await saveTradeRecord({ accountId: "primary", accountName: "帳號", baseVersion: null, baselineJson: durableTradeJson(data()), serialized: durableTradeJson({ ...data(), note: "new" }), fetcher: async (url, opts) => {
    if (opts.method === "GET") return response(200, { account: account(7), dataset: data() });
    assert.equal(JSON.parse(opts.body).baseVersion, 7); return response(200, { account: account(8) });
  } });
  assert.equal(saved.account.version, 8);
  await assert.rejects(saveTradeRecord({ accountId: "primary", accountName: "帳號", baseVersion: 1, serialized: durableTradeJson(data()), fetcher: async () => response(503, { error: "offline" }) }), e => e.retryable);
});

test("save queue serializes edits and remains usable after a failure", async () => {
  const queue = createRecordSaveQueue(), events = [];
  let release;
  const first = queue(async () => { events.push(1); await new Promise(resolve => { release = resolve; }); throw Error("offline"); });
  const failure = assert.rejects(first, /offline/);
  const second = queue(async () => { events.push(2); return 2; });
  await Promise.resolve(); assert.deepEqual(events, [1]); release();
  await failure; assert.equal(await second, 2); assert.deepEqual(events, [1,2]);
});

test("manual and auto saving share compact cloud snapshots, and unload is guarded", () => {
  const source = readFileSync(new URL("../app/trade-workspace.tsx", import.meta.url), "utf8");
  assert.match(source,/BACKGROUND_SAVE_MS/);
  assert.ok(source.includes('persistCompleteSnapshot(true, "手動")'));
  assert.ok(source.includes("serializeInBackground(compactCloudSnapshot(captured.dataset, performanceResource.getSnapshot().history?.cache))"));
  assert.ok(source.includes("立即儲存"));
  assert.match(source, /beforeunload/);
  assert.doesNotMatch(source, /writeLocalRecord|readPendingRecord|localStorage\.setItem/);
  assert.doesNotMatch(source, /雲端儲存失敗，本機備份仍安全/);
});


test("HTML gateway errors retain HTTP status and keep pending saves retryable", async () => {
  await assert.rejects(saveTradeRecord({accountId:"primary",accountName:"帳號",baseVersion:1,serialized:durableTradeJson(data()),fetcher:async()=>({ok:false,status:503,json:async()=>{throw new SyntaxError("The string did not match the expected pattern.");}})}),e=>e.status===503 && e.retryable && e.message.includes("HTTP 503") && !e.message.includes("expected pattern"));
});
test("HTML gateway save failure verifies the base version and retries once without duplicating a version", async () => {
  const baseline=data(), changed={...data(),note:"new"}, serialized=durableTradeJson(changed), calls=[];
  const saved=await saveTradeRecord({accountId:"primary",accountName:"帳號",baseVersion:1,baselineJson:durableTradeJson(baseline),serialized,fetcher:async(url,options)=>{
    calls.push(options.method);
    if(options.method==="GET")return response(200,{account:account(1),dataset:baseline});
    if(calls.filter(method=>method==="PUT").length===1)return {ok:false,status:503,json:async()=>{throw new SyntaxError("gateway HTML");}};
    return response(200,{account:account(2)});
  }});
  assert.equal(saved.account.version,2);
  assert.deepEqual(calls,["PUT","GET","PUT"]);
});
test("malformed successful response never reports a confirmed save", async()=>{
  for(const body of [null,[],{}, {account:{version:"2"}}]) await assert.rejects(saveTradeRecord({accountId:"primary",accountName:"帳號",baseVersion:1,serialized:durableTradeJson(data()),fetcher:async()=>response(200,body)}),e=>e.status===502 && e.retryable);
});


test("aborted upload confirms a committed snapshot without a duplicate write", async () => {
 const dataset=data(), serialized=JSON.stringify(dataset); let puts=0;
 const saved=await saveTradeRecord({accountId:"primary",accountName:"test",serialized,baseVersion:1,fetcher:async(url,options)=>{
  if(options.method==="PUT"){puts++;throw new DOMException("Fetch is aborted","AbortError");}
  return response(200,{account:account(2),dataset});
 }});
 assert.equal(puts,1);assert.equal(saved.account.version,2);
});
test("unconfirmed abort retains retryable Chinese error; session errors remain terminal",async()=>{
 await assert.rejects(saveTradeRecord({accountId:"primary",accountName:"test",serialized:JSON.stringify(data()),baseVersion:1,fetcher:async()=>{throw new DOMException("Fetch is aborted","AbortError");}}),e=>e.status===504&&e.retryable&&e.message.includes("尚未確認"));
 await assert.rejects(saveTradeRecord({accountId:"primary",accountName:"test",serialized:JSON.stringify(data()),baseVersion:1,fetcher:async()=>{throw Object.assign(new Error("session ended"),{status:401,retryable:false});}}),e=>e.status===401&&!e.retryable);
});

test("cloud refresh accepts clean data but preserves unsynced edits and unknown baselines", () => {
 const baseline = data();
 assert.equal(canRefreshCloudRecord(JSON.stringify({...baseline,marketBars:[{close:10}]}),JSON.stringify(baseline)),true);
 assert.equal(canRefreshCloudRecord(JSON.stringify({...baseline,cycleReviews:{one:{comment:'local'}}}),JSON.stringify(baseline)),false);
 assert.equal(canRefreshCloudRecord(JSON.stringify(baseline),''),false);
 assert.equal(canRefreshCloudRecord('invalid',JSON.stringify(baseline)),false);
});

test('normalized accounts send only authored entity changes and acknowledge the D1 version',async()=>{
 const baseline=data(),next={...baseline,profile:{name:'增量帳本'},marketBars:[{symbol:'AAA',date:'2026-10-10',close:10}]},calls=[];
 const saved=await saveTradeRecord({accountId:'primary',accountName:'帳號',baseVersion:4,baselineJson:JSON.stringify(baseline),serialized:JSON.stringify(next),incremental:true,fetcher:async(url,options)=>{
  calls.push({url,options});const body=JSON.parse(options.body);assert.equal(body.baseVersion,4);assert.equal(body.operations.length,1);assert.equal(body.operations[0].section,'profile');return response(200,{account:{...account(5),storageMode:'normalized'},sync:{status:'updating'}});
 }});
 assert.equal(saved.account.version,5);assert.equal(calls.length,1);assert.match(calls[0].url,/\/mutations$/);assert.equal(calls[0].options.method,'POST');
});

test('inactive incremental accounts fail safely without a full overwrite',async()=>{
 const baseline=data(),next={...baseline,profile:{name:'影子驗證'}},methods=[];
 await assert.rejects(saveTradeRecord({accountId:'primary',accountName:'帳號',baseVersion:1,baselineJson:JSON.stringify(baseline),serialized:JSON.stringify(next),incremental:true,fetcher:async(url,options)=>{
  methods.push(options.method);return response(428,{error:'not active'});
 }}),error=>error.status===428);
 assert.deepEqual(methods,['POST']);
});


test('unchanged and quote-only saves never call an endpoint, including manual save',async()=>{
 const baseline=data();for(const next of [baseline,{...baseline,marketBars:[{close:999}],marketSnapshot:{quotes:{AAA:{price:888}}},dashboardSummary:{version:99}}]){
 const saved=await saveTradeRecord({accountId:'primary',accountName:'帳本',baseVersion:1,baselineJson:JSON.stringify(baseline),serialized:JSON.stringify(next),incremental:true,fetcher:()=>{throw Error('must not fetch');}});
 assert.equal(saved.unchanged,true);assert.equal(saved.account.version,1);
 }
});
test('uncertain mutation retry keeps its ID and never falls back to PUT',async()=>{
 const base=data(),next={...base,positionPlans:{a:{stopLoss:5}}},ids=[];
 const args={accountId:'primary',accountName:'帳本',baseVersion:1,baselineJson:JSON.stringify(base),serialized:JSON.stringify(next),incremental:true};
 await assert.rejects(saveTradeRecord({...args,fetcher:async(_,options)=>{assert.equal(options.method,'POST');ids.push(JSON.parse(options.body).mutationId);throw Error('network');}}));
 const saved=await saveTradeRecord({...args,fetcher:async(_,options)=>{ids.push(JSON.parse(options.body).mutationId);return response(200,{account:account(2)});}});
 assert.equal(saved.account.version,2);assert.equal(ids[0],ids[1]);
});
test('quota metadata reaches the retry controller without an immediate retry',async()=>{
 const baseline=data();let calls=0;
 await assert.rejects(saveTradeRecord({accountId:'primary',baseVersion:1,baselineJson:JSON.stringify(baseline),serialized:JSON.stringify({...baseline,note:'edit'}),incremental:true,fetcher:async()=>{calls++;return response(429,{error:'quota',code:'D1_DAILY_LIMIT',retryAt:'2026-10-13T00:00:00.000Z'});}}),e=>e.code==='D1_DAILY_LIMIT'&&e.retryAt==='2026-10-13T00:00:00.000Z');assert.equal(calls,1);
});
test('nonoverlapping changes reconcile as incremental writes only',async()=>{
 const base=data(),local={...base,positionPlans:{a:{stopLoss:5}}},server={...base,cycleReviews:{b:{note:'remote'}}},calls=[];
 const saved=await saveTradeRecord({accountId:'primary',baseVersion:1,baselineJson:JSON.stringify(base),serialized:JSON.stringify(local),incremental:true,fetcher:async(_,options)=>{calls.push(options.method);if(calls.length===1)return response(409,{});if(options.method==='GET')return response(200,{account:account(2),dataset:server});assert.equal(JSON.parse(options.body).baseVersion,2);return response(200,{account:account(3)});}});
 assert.deepEqual(calls,['POST','GET','POST']);assert.equal(saved.dataset.positionPlans.a.stopLoss,5);assert.equal(saved.dataset.cycleReviews.b.note,'remote');
});
