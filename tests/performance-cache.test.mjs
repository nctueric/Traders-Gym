import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPerformanceHistory} from '../lib/performance-history.mjs';
import {createPerformanceHistoryResource,memoryPerformanceCache} from '../lib/performance-cache.mjs';
const now=()=>Date.parse('2026-10-06T10:00:00Z');
const target={symbol:'QQQ',basis:'adjusted',start:'2026-01-01',end:'2026-01-03'};
const response=(url)=>{const q=new URL(url,'http://test').searchParams;return {ok:true,json:async()=>({priceBasis:q.get('priceBasis'),bars:[{date:q.get('end'),close:100}]})};};
const storage=()=>{let value=null;return {read:async()=>value,write:async(v)=>{value=structuredClone(v);},value:()=>value};};
test('preload shares in-flight work and restored cache without another request',async()=>{
 let calls=0,release;const gate=new Promise(r=>release=r),store=storage();
 const resource=createPerformanceHistoryResource({storage:store,now,fetcher:async url=>{calls++;await gate;return response(url);}});
 const a=resource.load([target]),b=resource.load([target]);await Promise.resolve();release();await Promise.all([a,b]);
 assert.equal(calls,1);assert.equal(resource.getSnapshot().loading,false);assert.equal(resource.getSnapshot().history.cache.entries['QQQ:adjusted'].bars.length,1);
 const restored=createPerformanceHistoryResource({storage:store,now,fetcher:async()=>{throw new Error('must not fetch');}});
 await restored.load([target]);assert.deepEqual(restored.getSnapshot().history.errors,[]);
});
test('successful chunks are checkpointed before a later abort and resumed',async()=>{
 let calls=0,saved;const controller=new AbortController();const long={...target,start:'2024-01-01',end:'2026-01-03'};
 await assert.rejects(loadPerformanceHistory([long],null,async url=>{if(++calls===2){controller.abort();throw new Error('offline');}return response(url);},controller.signal,null,{now:now(),checkpoint:v=>{saved=v;}}));
 assert.ok(saved.entries['QQQ:adjusted'].coverage.length);const ranges=[];
 await loadPerformanceHistory([long],saved,async url=>{ranges.push(new URL(url,'http://test').searchParams.get('end'));return response(url);},new AbortController().signal,null,{now:now()});
 assert.ok(ranges.every(end=>end>saved.entries['QQQ:adjusted'].coverage[0].end));
});
test('recent week refreshes after six hours, old coverage remains, force refreshes all',async()=>{
 const recent={...target,start:'2026-01-01',end:'2026-10-05'},urls=[];
 const saved={version:1,entries:{'QQQ:adjusted':{bars:[{date:'2026-01-01',close:100}],coverage:[{...recent,market:'adjusted',fetchedAt:'2026-10-05T00:00:00Z'}]}}};
 const a=await loadPerformanceHistory([recent],saved,async url=>{urls.push(url);return response(url);},new AbortController().signal,null,{now:now()});
 assert.equal(a.cache.entries['QQQ:adjusted'].coverage.at(-1).start,'2026-09-29');
 const b=await loadPerformanceHistory([recent],a.cache,async()=>{throw new Error('cached');},new AbortController().signal,null,{now:now()});assert.deepEqual(b.errors,[]);
 const c=await loadPerformanceHistory([recent],b.cache,async url=>response(url),new AbortController().signal,null,{now:now(),force:true});assert.ok(c.cache.entries['QQQ:adjusted'].coverage.some(range=>range.start==='2026-01-01'&&range.fetchedAt===new Date(now()).toISOString()));
});
test('storage errors retain usable prices; account/demo caches are isolated',async()=>{
 const resource=createPerformanceHistoryResource({storage:{read:async()=>null,write:async()=>{throw new Error('quota');}},now,fetcher:async url=>response(url)});
 await resource.load([target]);assert.ok(resource.getSnapshot().history.cache);assert.match(resource.getSnapshot().status,/快取未保存/);
 const a=memoryPerformanceCache('user-a:ledger'),b=memoryPerformanceCache('user-b:ledger');
 await a.write({version:1,entries:{}});assert.equal(await b.read(),null);assert.equal((await a.read()).version,1);
 const reloaded=memoryPerformanceCache('user-a:ledger');assert.equal(await reloaded.read(),null);
});
test('failed ranges retry, concurrency bounded to three, disposed results never publish',async()=>{
 let active=0,max=0;const targets=Array.from({length:6},(_,i)=>({...target,symbol:'S'+i}));
 const result=await loadPerformanceHistory(targets,null,async url=>{active++;max=Math.max(max,active);await new Promise(r=>setImmediate(r));active--;return response(url);},new AbortController().signal,null,{now:now()});assert.equal(max,3);assert.equal(result.errors.length,0);
 let release;const gate=new Promise(r=>release=r),store=storage();const resource=createPerformanceHistoryResource({storage:store,now,fetcher:async url=>{await gate;return response(url);}});
 const pending=resource.load([target]);await Promise.resolve();resource.dispose();release();await pending;assert.equal(resource.getSnapshot().history,null);assert.equal(store.value(),null);
 let count=0;const retry=createPerformanceHistoryResource({storage:storage(),now,fetcher:async url=>{if(++count===1)throw new Error('offline');return response(url);}});
 await retry.load([target]);assert.equal(retry.getSnapshot().history.errors.length,1);await retry.retry();assert.equal(retry.getSnapshot().history.errors.length,0);assert.equal(count,2);
});
test('timed-out ranges remain retryable and do not claim coverage',async()=>{
 const result=await loadPerformanceHistory([target],null,(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')))),new AbortController().signal,null,{now:now(),requestTimeoutMs:5});
 assert.match(result.errors[0],/逾時/);assert.equal(result.cache.entries['QQQ:adjusted'].coverage.length,0);
});
