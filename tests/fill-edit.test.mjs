import test from 'node:test';
import assert from 'node:assert/strict';
import {updateRecordedFill} from '../lib/fill-edit.mjs';
import {buildCycles} from '../lib/trade-engine.mjs';
import {completeTradeJson} from '../lib/trade-record-store.mjs';

const at='2026-08-28T18:00:00Z';
const first={id:'buy',accountId:'usd',market:'NASDAQ',currency:'USD',symbol:'AAA',side:'BUY',quantity:10,price:100,fee:1,timestamp:'2026-08-20T15:00:30Z',note:'原成交',entryMode:'SIMPLE',tradeDate:'2026-08-20',timeSource:'STANDARD_CLOSE'};
const sell={...first,id:'sell',side:'SELL',quantity:4,price:120,fee:0,timestamp:'2026-08-24T15:00:00Z'};
const fixture=()=>({profile:{name:'test'},accounts:[{id:'usd',currency:'USD'},{id:'twd',currency:'TWD'}],fills:[first,sell],marketBars:[],settings:{},entryContexts:{buy:{fillId:'buy',cycleId:'cycle-buy',fillPrice:100,recordedAt:'2026-08-20T16:00:00Z'}},cycleReviews:{'cycle-buy':{reflection:'原心得'}}});
const draft=(fill,patch={})=>({accountId:fill.accountId,market:fill.market,symbol:fill.symbol,side:fill.side,quantity:String(fill.quantity),price:String(fill.price),fee:String(fill.fee),timestamp:fill.timestamp,note:fill.note||'',...patch});

test('correcting an execution updates FIFO position and realized cycle while preserving its id and original evidence',()=>{
 const data=fixture();data.fills.push({...sell,id:'final',quantity:6,timestamp:'2026-08-25T15:00:00Z'});const before=buildCycles(data);
 const next=updateRecordedFill(data,first,draft(first,{quantity:'12',price:'110',fee:'2'}),at);
 const after=buildCycles(next);
 assert.equal(before.cycles.length,1);
 assert.equal(after.positions[0].quantity,2);
 assert.equal(after.cycles.length,0);
 assert.equal(next.fills[0].id,'buy');
 assert.equal(next.fills[0].entryMode,'SIMPLE');
 assert.equal(next.entryContexts.buy.fillPrice,100);
 assert.equal(next.entryContexts.buy.fillEditedAt,at);
 assert.deepEqual(next.fillEditHistory[0].before,first);
 assert.equal(JSON.parse(completeTradeJson(next)).fills[0].quantity,12);
 assert.deepEqual(data.fills[0],first);
});

test('moving an execution earlier remaps cycle annotations and updates its displayed trading date',()=>{
 const data=fixture();data.fills=[sell,first];
 const next=updateRecordedFill(data,first,draft(first,{timestamp:'2026-08-19T15:00:30Z'}),at);
 assert.equal(next.fills.find(fill=>fill.id==='buy').tradeDate,'2026-08-19');
 assert.equal(next.fills.find(fill=>fill.id==='buy').timeSource,undefined);
 assert.equal(next.cycleReviews['cycle-buy'].reflection,'原心得');
 assert.equal(next.fillEditHistory.length,1);
});

test('invalid values and stale editor state cannot modify the ledger',()=>{
 const data=fixture(),original=JSON.stringify(data);
 for(const patch of [{quantity:'0'},{price:'Infinity'},{fee:'-1'},{symbol:'BAD SYMBOL'},{market:'TWSE'},{timestamp:'2026-08-29T00:00:00Z'}])assert.throws(()=>updateRecordedFill(data,first,draft(first,patch),at));
 assert.throws(()=>updateRecordedFill(data,{...first,price:90},draft(first),at),/已更新/);
 assert.equal(JSON.stringify(data),original);
 assert.equal(updateRecordedFill(data,first,draft(first),at),data);
});
