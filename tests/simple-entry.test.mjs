import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimpleDraft,previewSimpleBatch,commitSimpleBatch,simpleTimestamp,resolveSymbolMarket} from '../lib/simple-entry.mjs';
import {commitEntry,previewEntry} from '../lib/trade-entry.mjs';
import {buildCycles} from '../lib/trade-engine.mjs';
const now='2026-10-06T16:00:00Z';
const base=()=>({profile:{name:'Test'},accounts:[{id:'us',currency:'USD'},{id:'tw',currency:'TWD'}],fills:[],settings:{},marketBars:[],positionPlans:{},strategyAssignments:{},planHistory:[]});
const row=(id,side='BUY',quantity=10)=>({id,symbol:'AAA',market:'NYSE',side,quantity,price:100,fee:1});
const batch=(rows,date='2026-10-06')=>({id:'batch',accountId:'us',date,rows});
test('market dates, standard close and DST are independent of device timezone',()=>{
 assert.equal(simpleTimestamp('2026-07-01','NYSE',now).timestamp,'2026-07-01T20:00:00.000Z');
 assert.equal(simpleTimestamp('2026-01-02','NASDAQ',now).timestamp,'2026-01-02T21:00:00.000Z');
 assert.equal(simpleTimestamp('2026-10-05','TWSE',now).timestamp,'2026-10-05T05:30:00.000Z');
 assert.equal(simpleTimestamp('2026-10-06','NYSE',now).timestamp,now.replace('Z','.000Z'));
 assert.throws(()=>simpleTimestamp('2026-10-07','NYSE',now));assert.throws(()=>simpleTimestamp('2026-02-30','NYSE',now));
 assert.equal(createSimpleDraft(base().accounts,'2026-10-06T01:00:00Z').date,'2026-10-05');
});
test('batch follows row order through entry/add/reduce/exit/reversal with no fabricated plans',()=>{
 const d=base(),b=batch([row('a'),row('b'),row('c','SELL',5),row('d','SELL',15),row('e'),row('f','SELL',20)]);
 const p=previewSimpleBatch(d,b,now);assert.deepEqual(p.rows.map(r=>r.action),['ENTRY','ADD','REDUCE','EXIT','ENTRY','REVERSAL']);
 const next=commitSimpleBatch(d,b,p.confirmationKey,now);assert.equal(d.fills.length,0);assert.equal(next.fills.length,6);
 assert.deepEqual(next.positionPlans,{});assert.deepEqual(next.planHistory,[]);assert.deepEqual(next.strategyAssignments,{});assert.equal(next.entryContexts,undefined);
 assert.equal(new Set(next.fills.map(f=>f.timestamp)).size,1);
 assert.throws(()=>commitSimpleBatch(next,b,p.confirmationKey,now),/重複/);
});
test('partial rows, invalid currency, duplicate ids and >100 rows reject whole batch',()=>{
 const d=base();for(const rows of [[row('a'),{id:'b',symbol:'B'}],[row('a'),row('a')],[{...row('a'),market:'TWSE'}],Array.from({length:101},(_,i)=>row(String(i)))]){
  const b=batch(rows);const p=previewSimpleBatch(d,b,now);assert.ok(p.errors.length);assert.throws(()=>commitSimpleBatch(d,b,p.confirmationKey,now));assert.equal(d.fills.length,0);
 }
 const p=previewSimpleBatch(d,batch([row('a'),{id:'blank',symbol:'',quantity:'',price:'',fee:'0'}]),now);assert.equal(p.rows.length,1);
});
test('confirmation expires on ledger change or market midnight; unchanged date uses final submission time',()=>{
 const d=base(),b=batch([row('a')]),p=previewSimpleBatch(d,b,now);
 assert.throws(()=>commitSimpleBatch({...d,cashActivities:[{id:'changed'}]},b,p.confirmationKey,now),/重新/);
 assert.throws(()=>commitSimpleBatch(d,b,p.confirmationKey,'2026-10-07T05:00:00Z'),/重新/);
 assert.equal(commitSimpleBatch(d,b,p.confirmationKey,'2026-10-06T17:00:00Z').fills[0].timestamp,'2026-10-06T17:00:00.000Z');
});
test('market lookup never guesses and duplicate fills are warnings',()=>{
 const d=base();assert.equal(resolveSymbolMarket(d,'AAA','USD'), '');
 assert.equal(resolveSymbolMarket(d,'AAA','USD',{AAA:{symbol:'AAA',exchange:'NYQ'}}),'NYSE');
 d.fills=[{...row('old'),accountId:'us',timestamp:now,currency:'USD'}];assert.equal(resolveSymbolMarket(d,'AAA','USD'),'NYSE');
 assert.equal(previewSimpleBatch(d,batch([row('new')]),now).rows[0].duplicate,true);
});
test('simple and full registration have identical FIFO quantities and PnL',()=>{
 const d=base(),b=batch([row('a'),{...row('b','SELL'),price:120}]),p=previewSimpleBatch(d,b,now);
 const simple=commitSimpleBatch(d,b,p.confirmationKey,now);
 let full=d;for(const r of b.rows){const draft={...r,accountId:'us',timestamp:now};const preview=previewEntry(full,draft,now);full=commitEntry(full,{...draft,confirmedKey:preview.confirmationKey},{quotes:{}},now);}
 const extract=x=>{const r=buildCycles(x);return {p:r.positions.map(p=>[p.symbol,p.quantity]),c:r.cycles.map(c=>[c.quantity,c.pnl,c.averageEntry,c.averageExit])};};
 assert.deepEqual(extract(simple),extract(full));
});
