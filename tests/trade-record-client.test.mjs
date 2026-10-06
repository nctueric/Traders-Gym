import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { durableTradeJson, validateTradeRecordPayload } from "../lib/trade-record-store.mjs";
import { canRefreshCloudRecord, createRecordSaveQueue, readPendingRecord, saveTradeRecord, writeLocalRecord } from "../lib/trade-record-client.mjs";

const data = () => ({ profile: { name: "帳號" }, accounts: [], fills: [], marketBars: [], settings: {} });
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });
const account = version => ({ id: "primary", name: "帳號", version, updatedAt: "2026-08-28T00:00:00Z" });
function storage() { const map = new Map(); return { map, getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v) }; }

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
  await assert.rejects(saveTradeRecord({ accountId: "primary", accountName: "帳號", baseVersion: 1, baselineJson: durableTradeJson(data()), serialized: durableTradeJson({ ...data(), strategies: [1] }), fetcher: async (url, options) => {
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

test("login always displays cloud data while pending edits are archived", () => {
  const local = storage(), base = data(), edited = { ...data(), note: "edited" };
  assert.equal(writeLocalRecord(local, "records", "primary", durableTradeJson(edited), durableTradeJson(base), 1), true);
  const recovered = readPendingRecord(local, "records", "primary", base);
  assert.equal(recovered.archivedPending, true);
  assert.deepEqual(recovered.dataset, base);
  assert.equal(local.getItem(recovered.recoveryKey), local.getItem("records.primary.pending"));
  assert.deepEqual(readPendingRecord(local, "records", "primary", { ...base, other: 1 }).dataset, { ...base, other: 1 });
  assert.deepEqual(readPendingRecord(local, "records", "primary", edited).dataset, edited);
  assert.equal(writeLocalRecord({ setItem() { throw Error("quota"); } }, "records", "primary", "x", "y", 1), false);
});

test("legacy cache is preserved separately, not guessed to be newer", () => {
  const local = storage(), old = JSON.stringify({ ...data(), note: "unconfirmed" });
  local.setItem("records.primary", old);
  const result = readPendingRecord(local, "records", "primary", data());
  assert.equal(local.getItem(result.legacyRecoveryKey), old);
  assert.deepEqual(result.dataset, data());
});

test("manual and auto saving share complete snapshots, and unload is guarded", () => {
  const source = readFileSync(new URL("../app/trade-workspace.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("window.setInterval(() => backgroundSaveRef.current(), 600_000)"));
  assert.ok(source.includes('persistCompleteSnapshot(true, "手動")'));
  assert.ok(source.includes("serializeInBackground(captured.dataset)"));
  assert.ok(source.includes("立即儲存"));
  assert.match(source, /beforeunload/);
  assert.match(source, /writeLocalRecord\(recordStorage\(\)/);
  assert.doesNotMatch(source, /雲端儲存失敗，本機備份仍安全/);
});


test("HTML gateway errors retain HTTP status and keep pending saves retryable", async () => {
  await assert.rejects(saveTradeRecord({accountId:"primary",accountName:"帳號",baseVersion:1,serialized:durableTradeJson(data()),fetcher:async()=>({ok:false,status:503,json:async()=>{throw new SyntaxError("The string did not match the expected pattern.");}})}),e=>e.status===503 && e.retryable && e.message.includes("HTTP 503") && !e.message.includes("expected pattern"));
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

test('empty pending journal cannot replace a populated cloud ledger and is quarantined intact', () => {
  const local=storage(), base={...data(),fills:[{id:'original'}],cashActivities:[{id:'cash'}]};
  const empty={...data(),fills:[],cashActivities:[]};
  writeLocalRecord(local,'records','primary',JSON.stringify(empty),JSON.stringify(base),394);
  const original=local.getItem('records.primary.pending');
  const result=readPendingRecord(local,'records','primary',base);
  assert.deepEqual(result.dataset,base);assert.equal(result.archivedPending,true);
  assert.equal(result.recovered,undefined);assert.equal(local.getItem(result.recoveryKey),original);
  const blocked=readPendingRecord({getItem:k=>local.getItem(k),setItem(){throw Error('quota');}},'records','primary',base);
  assert.deepEqual(blocked.dataset,base);assert.equal(blocked.conflict,true);
  assert.equal(local.getItem('records.primary.pending'),original);
});

test("cloud refresh accepts clean data but preserves unsynced edits and unknown baselines", () => {
 const baseline = data();
 assert.equal(canRefreshCloudRecord(JSON.stringify({...baseline,marketBars:[{close:10}]}),JSON.stringify(baseline)),true);
 assert.equal(canRefreshCloudRecord(JSON.stringify({...baseline,cycleReviews:{one:{comment:'local'}}}),JSON.stringify(baseline)),false);
 assert.equal(canRefreshCloudRecord(JSON.stringify(baseline),''),false);
 assert.equal(canRefreshCloudRecord('invalid',JSON.stringify(baseline)),false);
});
