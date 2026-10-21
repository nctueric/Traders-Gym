import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDataset} from '../lib/auth-core.mjs';
import {writeLedgerRecordCache,readLedgerRecordCache} from '../lib/ledger-record-cache.mjs';

// Exercises IDB request-success versus transaction-commit ordering, including abort.
function device(t){
 const previous=globalThis.indexedDB,rows=new Map();let abort=false;
 globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result={close(){},transaction(_,mode){const working=new Map(rows),tx={error:Error('quota exhausted')};const store={get(key){const r={};queueMicrotask(()=>{r.result=working.get(key);r.onsuccess?.();setTimeout(()=>{if(abort&&mode==='readwrite')tx.onabort?.();else{if(mode==='readwrite'){rows.clear();for(const entry of working)rows.set(...entry);}tx.oncomplete?.();}},0);});return r;},put(value){working.set(value.key,structuredClone(value));},delete(key){working.delete(key);return {};}};tx.objectStore=()=>store;return tx;}};request.onsuccess?.();});return request;}};
 t.after(()=>{globalThis.indexedDB=previous;});return {rows,set abort(value){abort=value;}};
}
const record=dataset=>({account:{id:'ledger',version:1},accounts:[],dataset});
test('IDB transaction abort never acknowledges a local backup',async t=>{
 const d=device(t),baseline=emptyDataset(),next={...baseline,note:'pending'};d.abort=true;
 assert.equal(await writeLedgerRecordCache({userId:'u',record:record(next),pending:true,baselineJson:JSON.stringify(baseline)}),false);assert.equal(d.rows.size,0);
});
test('newer pending edits survive old cloud acknowledgement and restore as a conflict',async t=>{
 const d=device(t),baseline=emptyDataset(),first={...baseline,note:'first'},latest={...baseline,note:'latest'};
 await writeLedgerRecordCache({userId:'u',record:record(latest),pending:true,baselineJson:JSON.stringify(baseline)});
 assert.ok(d.rows.get('u:ledger').pendingBatch.mutationId);
 await writeLedgerRecordCache({userId:'u',record:{...record(first),account:{id:'ledger',version:2}},acknowledgedJson:JSON.stringify(first)});
 const pending=await readLedgerRecordCache({userId:'u',accountId:'ledger',version:2});assert.equal(pending.dataset.note,'latest');assert.equal(pending.cacheConflict,true);
 assert.equal(await readLedgerRecordCache({userId:'other',accountId:'ledger',version:2}),null);
});
test('matching acknowledgement clears only confirmed edits',async t=>{
 device(t);const baseline=emptyDataset(),next={...baseline,note:'saved'};
 await writeLedgerRecordCache({userId:'u',record:record(next),pending:true,baselineJson:JSON.stringify(baseline)});
 await writeLedgerRecordCache({userId:'u',record:{...record(next),account:{id:'ledger',version:2}},acknowledgedJson:JSON.stringify(next)});
 const saved=await readLedgerRecordCache({userId:'u',accountId:'ledger',version:2});assert.equal(saved.cachePending,false);assert.equal(saved.dataset.note,'saved');
});

test('undoing an edit replaces this tab pending draft with the clean baseline',async t=>{
 device(t);const baseline=emptyDataset(),next={...baseline,note:'undone'};
 await writeLedgerRecordCache({userId:'u',record:record(next),pending:true,baselineJson:JSON.stringify(baseline)});
 await writeLedgerRecordCache({userId:'u',record:record(baseline),pending:false,localEdit:true});
 const saved=await readLedgerRecordCache({userId:'u',accountId:'ledger',version:1});assert.equal(saved.cachePending,false);assert.equal(saved.dataset.note,undefined);
});
