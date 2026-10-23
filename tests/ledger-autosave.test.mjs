import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleLedgerAutosave,isCurrentCheckpoint,EDIT_SAVE_DELAY_MS} from '../lib/ledger-autosave.mjs';

const baseline=JSON.stringify({accounts:[],fills:[],settings:{},marketBars:[]});
const changed=JSON.stringify({...JSON.parse(baseline),settings:{currency:'TWD'}});
test('durable edits sync after two seconds, and cleanup cancels an obsolete edit',()=>{
 const tasks=new Map();let next=0,saves=0;
 const options={baselineJson:baseline,serialized:changed,save:()=>saves++,schedule:(fn,delay)=>{assert.equal(delay,2000);tasks.set(++next,fn);return next;},cancel:id=>tasks.delete(id)};
 const cleanup=scheduleLedgerAutosave(options);cleanup();assert.equal(tasks.size,0);
 scheduleLedgerAutosave(options);for(const fn of tasks.values())fn();assert.equal(saves,1);
 assert.equal(EDIT_SAVE_DELAY_MS,2000);
});
test('clean, market-only, offline and conflicted ledgers do not schedule writes',()=>{
 const schedule=()=>assert.fail('unexpected upload');
 scheduleLedgerAutosave({serialized:baseline,baselineJson:baseline,save:()=>{},schedule});
 scheduleLedgerAutosave({serialized:JSON.stringify({...JSON.parse(baseline),marketBars:[{symbol:'AAPL',close:100}],marketSnapshot:{lastQuoteAt:123}}),baselineJson:baseline,save:()=>{},schedule});
 scheduleLedgerAutosave({serialized:changed,baselineJson:baseline,blocked:true,save:()=>{},schedule});
});
test('late local completion cannot overwrite cloud acknowledgement, newer edits or another ledger',()=>{
 const captured={accountId:'a',serialized:changed};
 assert.equal(isCurrentCheckpoint(captured,captured,baseline,baseline),true);
 assert.equal(isCurrentCheckpoint(captured,captured,baseline,changed),false);
 assert.equal(isCurrentCheckpoint(captured,{...captured,serialized:baseline},baseline,baseline),false);
 assert.equal(isCurrentCheckpoint(captured,{...captured,accountId:'b'},baseline,baseline),false);
});
