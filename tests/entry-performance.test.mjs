import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {cacheDatasetPatch,applyCacheDatasetPatch} from '../lib/ledger-cache-transfer.mjs';
import {createBackgroundLedgerCache} from '../lib/ledger-cache-client.mjs';
import {homeLoadFixture} from './home-load-fixture.mjs';

test('draft checkpoints transfer only edits, retaining complete multi-megabyte recovery data',()=>{
 const before=homeLoadFixture('2026-10-22T00:00:00Z');
 const after={...before,simpleEntryDraft:{id:'draft',rows:[{symbol:'AAPL',quantity:'12'}]},marketSnapshot:{...before.marketSnapshot}};
 const patch=cacheDatasetPatch(before,after);
 assert.ok(JSON.stringify(before).length>7_000_000);
 assert.ok(JSON.stringify(patch).length<200);
 assert.deepEqual(applyCacheDatasetPatch(structuredClone(before),patch),after);
 const cleared={...after};delete cleared.simpleEntryDraft;
 assert.deepEqual(applyCacheDatasetPatch(after,cacheDatasetPatch(after,cleared)),cleared);
 const history={...after,marketBars:[],marketSnapshot:{...after.marketSnapshot,lastQuoteAt:123}};
 assert.deepEqual(applyCacheDatasetPatch(after,cacheDatasetPatch(after,history)),history);
});
test('worker checkpoints remain ordered and user/ledger switches replace the base',async()=>{
 const messages=[],datasets=[];let current=null;
 const worker={postMessage(message){messages.push(structuredClone(message));current=applyCacheDatasetPatch(current,message.patch);datasets.push(current);queueMicrotask(()=>this.onmessage({data:{ok:true}}));},terminate(){}};
 const cache=createBackgroundLedgerCache({createWorker:()=>worker});
 const data=homeLoadFixture('2026-10-22T00:00:00Z');
 const baselineJson=JSON.stringify(data);
 const options=(userId,dataset)=>({userId,record:{account:{id:'a',version:1},dataset},pending:true,baselineJson});
 await Promise.all([cache.write(options('u',data)),cache.write(options('u',{...data,entryDraft:{symbol:'AAPL'}})),cache.write(options('other',data))]);
 assert.ok(messages[0].patch.replace);assert.equal(messages[1].patch.set.marketBars,undefined);assert.ok(messages[2].patch.replace);
 assert.equal(datasets[1].entryDraft.symbol,'AAPL');assert.equal(messages[1].optionsPatch.set.record.dataset,undefined);
 assert.equal(messages[1].optionsPatch.set.baselineJson,undefined);
 assert.ok(JSON.stringify(messages[1]).length<500,'entire checkpoint, including baseline metadata, stays small');
});
test('worker failure falls back in order; unsuccessful writes do not claim a base',async()=>{
 const data=homeLoadFixture('2026-10-22T00:00:00Z'),seen=[];
 const options={userId:'u',record:{account:{id:'a',version:1},dataset:data}};
 const cache=createBackgroundLedgerCache({createWorker(){throw Error('Unavailable');},fallback:async v=>{seen.push(v);return true;}});
 assert.deepEqual(await Promise.all([cache.write(options),cache.write({...options,pending:true})]),[true,true]);assert.equal(seen.length,2);
 const patches=[];let count=0;
 const worker={postMessage(m){patches.push(m.patch);queueMicrotask(()=>this.onmessage({data:{ok:++count>1}}));},terminate(){}};
 const retry=createBackgroundLedgerCache({createWorker:()=>worker});
 assert.equal(await retry.write(options),false);assert.equal(await retry.write(options),true);assert.ok(patches.every(p=>p.replace));
});
test('history preload ignores draft-only renders but responds to changed bars and fills',()=>{
 let index=0;const hooks=[],effects=[],calls={seed:0,load:0,dispose:0};
 const react={useMemo(fn,deps){const i=index++;if(!hooks[i]||deps.some((v,j)=>v!==hooks[i].deps[j]))hooks[i]={deps,value:fn()};return hooks[i].value;},useEffect(fn,deps){const i=index++;if(!hooks[i]||deps.some((v,j)=>v!==hooks[i].deps[j])){hooks[i]={deps};effects.push(fn);}}};
 const code=ts.transpileModule(readFileSync(new URL('../app/performance-preload.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports',code)(id=>id==='react'?react:id.includes('workspace-clock')?{useWorkspaceClock:()=> '2026-10-22T00:00:00Z'}:id.includes('performance-history')?{performanceRequests:d=>d.fills.map(f=>f.symbol)}:id.includes('snapshot-performance')?{performanceCacheFromSnapshot:d=>d}:{},mod,mod.exports);
 const resource={seed(){calls.seed++;},load(){calls.load++;},dispose(){calls.dispose++;}};
 const data=homeLoadFixture('2026-10-22T00:00:00Z');
 const render=d=>{index=0;mod.exports.PerformancePreload({data:d,resource,enabled:true});effects.splice(0).forEach(fn=>fn());};
 render(data);assert.deepEqual(calls,{seed:1,load:1,dispose:0});
 for(let i=0;i<20;i++)render({...data,simpleEntryDraft:{symbol:'AAPL',quantity:String(i)}});
 assert.deepEqual(calls,{seed:1,load:1,dispose:0});
 render({...data,marketBars:[...data.marketBars]});assert.equal(calls.seed,2);assert.equal(calls.load,1);
 render({...data,fills:[...data.fills,{symbol:'NEW'}]});assert.equal(calls.seed,3);assert.equal(calls.load,2);
});
test('overview periods are gated away from entry and valuation dependencies exclude drafts',()=>{
 const source=readFileSync(new URL('../app/trade-workspace.tsx',import.meta.url),'utf8');
 assert.match(source,/showOverview = tab === 'overview' \|\| tab === 'positions'/);
 assert.match(source,/useMemo\(\(\)=>showOverview\s*\? \['year','month','week'\]/);
 assert.match(source,/\[data.fills,data.cashActivities,data.marketBars\]/);
 assert.doesNotMatch(source,/overviewPeriodValuation\(data,/);
});
