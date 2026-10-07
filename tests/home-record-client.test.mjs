import test from 'node:test';import assert from 'node:assert/strict';import {loadHomeRecord} from '../lib/home-record-client.mjs';
const bootstrap={account:{id:'a',version:1},user:{sessionId:'s'}};
const response=(value,status=200)=>Response.json(value,{status});
test('verified same-version record passes through once with session scope; no preferences or second record request',async()=>{
 const full={account:{id:'a',version:1},dataset:{fills:[]}},calls=[];
 assert.deepEqual(await loadHomeRecord(async(url,opts)=>{calls.push(url);assert.equal(opts.headers['x-workspace-session'],'s');return response(full);},bootstrap),{record:full});assert.equal(calls.length,1);
});
test('changed version refreshes the summary and never exposes the mismatched full record',async()=>{
 const next={...bootstrap,account:{id:'a',version:2},home:{schemaVersion:1}},calls=[];
 const loaded=await loadHomeRecord(async url=>{calls.push(url);return response(url.includes('bootstrap')?next:{account:{id:'a',version:2},dataset:{fills:[]}});},bootstrap);assert.deepEqual(loaded,{bootstrap:next});assert.equal(calls.length,2);
});
test('checksum, login, fetch failures and cancellation never produce a writable record',async()=>{
 for(const status of [401,403,503])await assert.rejects(loadHomeRecord(async()=>response({error:'快照校驗失敗'},status),bootstrap),/校驗/);
 await assert.rejects(loadHomeRecord(async()=>{throw new DOMException('cancelled','AbortError');},bootstrap),e=>e.name==='AbortError');
 await assert.rejects(loadHomeRecord(async()=>response({account:{id:'other',version:1},dataset:{}}),bootstrap),/不一致/);
 await assert.rejects(loadHomeRecord(async()=>response({account:{id:'a',version:1}}),bootstrap),/不一致/);
});
test('missing refreshed view and switched session fail closed instead of accepting partial or private data',async()=>{
 for(const fresh of [{...bootstrap,home:null},{...bootstrap,home:{},user:{sessionId:'other'}}])await assert.rejects(loadHomeRecord(async url=>response(url.includes('bootstrap')?fresh:{account:{id:'a',version:2},dataset:{}}),bootstrap),/版本已更新/);
});
