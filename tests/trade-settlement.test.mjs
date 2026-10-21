import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSettlement,fillCashFlow} from '../lib/trade-settlement.mjs';
import {validateEntryDraft} from '../lib/trade-entry.mjs';
import {previewSimpleBatch,commitSimpleBatch,resolveSymbolMarket} from '../lib/simple-entry.mjs';
import {saveTradingAccount,selectTradingAccount} from '../lib/trading-accounts.mjs';
import {buildCurrentEquity} from '../lib/portfolio-engine.mjs';
import {updateRecordedFill} from '../lib/fill-edit.mjs';
import {normalizedDatasetEntries} from '../lib/normalized-ledger.mjs';

const now='2026-10-20T18:00:00Z';
const data=()=>({accounts:[{id:'broker',name:'券商',currency:'TWD'}],fills:[],cashActivities:[],marketBars:[],settings:{},profile:{},positionPlans:{},strategyAssignments:{}});
const fill=()=>({id:'f',accountId:'broker',symbol:'AAPL',market:'NASDAQ',currency:'USD',side:'BUY',quantity:10,price:100,fee:1,timestamp:now});
const fx=()=>({currency:'TWD',mode:'AUTO',feeCurrency:'USD',rate:'32',rateDate:'2026-10-20',forDate:'2026-10-20',source:'test'});
test('buy and sell cash use settlement currency exactly once; fees remain native for FIFO',()=>{
 const f=fill(),s=buildSettlement(f,fx());
 assert.equal(s.total,32032);assert.equal(s.nativeFee,1);
 assert.deepEqual(fillCashFlow({...f,settlement:s}),{currency:'TWD',amount:-32032});
 const sell={...f,side:'SELL'};assert.equal(buildSettlement(sell,fx()).total,31968);
 const d={...data(),fills:[{...f,settlement:s}]};
 assert.deepEqual(buildCurrentEquity(d,{},32,new Date(now)).cashByCurrency,{TWD:-32032});
 assert.deepEqual(fillCashFlow(f),{currency:'USD',amount:-1001});
});
test('decimal rounding, foreign fees and inverse conversion',()=>{
 assert.equal(buildSettlement({...fill(),price:0.1,quantity:3,fee:0},{currency:'USD',mode:'AUTO'}).total,0.3);
 const s=buildSettlement(fill(),{...fx(),feeCurrency:'TWD',feeAmount:32});
 assert.equal(s.total,32032);assert.equal(s.nativeFee,1);
 const inverse=buildSettlement({...fill(),currency:'TWD',price:3200,fee:0},{currency:'USD',mode:'RATE',rate:32});
 assert.equal(inverse.total,1000);
 assert.equal(buildSettlement({...fill(),price:1.005,quantity:1,fee:0},{currency:'USD'}).total,1.01);
});
test('actual total derives rate for buy/sell and both fee currencies',()=>{
 for(const side of ['BUY','SELL'])for(const feeCurrency of ['USD','TWD']){
  const f={...fill(),side},total=side==='BUY'?32032:31968;
  const s=buildSettlement(f,{currency:'TWD',mode:'TOTAL',total,feeCurrency,feeAmount:feeCurrency==='USD'?1:32});
  assert.equal(s.rate,32);assert.equal(s.total,total);assert.equal(s.nativeFee,1);
 }
});
test('missing/invalid rate cannot silently become a conversion; future date cannot reuse snapshot',()=>{
 for(const rate of [undefined,'',0,-1,Infinity])assert.throws(()=>buildSettlement(fill(),{...fx(),rate}));
 assert.throws(()=>buildSettlement(fill(),{...fx(),source:''}),/來源/);
 const p=validateEntryDraft(data(),{...fill(),settlement:{...fx(),forDate:'2026-10-19'}},now);
 assert.ok(p.errors.some(e=>e.includes('日期')));
});
test('mixed account/currency/date batch persists settlement in existing payloads atomically',()=>{
 const d=data(),batch={id:'batch',rows:[{...fill(),date:'2026-10-20',settlement:fx()},{...fill(),id:'tw',symbol:'2330',market:'TWSE',date:'2026-10-19',price:1000,fee:0,settlement:{currency:'TWD',mode:'AUTO'}}]};
 const p=previewSimpleBatch(d,batch,now);assert.deepEqual(p.errors,[]);
 const next=commitSimpleBatch(d,batch,p.confirmationKey,now);
 assert.equal(next.fills.length,2);assert.equal(d.fills.length,0);
 assert.equal(normalizedDatasetEntries(next).find(e=>e.section==='fills').value.settlement.currency,'TWD');
 assert.throws(()=>commitSimpleBatch(next,batch,p.confirmationKey,now));
 const invalid={...batch,rows:[...batch.rows,{...fill(),id:'bad',accountId:'missing'}]};
 assert.ok(previewSimpleBatch(d,invalid,now).errors.length);assert.equal(d.fills.length,0);
});
test('account creation is idempotent, defaults and unique holdings win, history is untouched',()=>{
 let d=saveTradingAccount(data(),{id:'new',name:'美股券商',currency:'USD'});
 d=saveTradingAccount(d,{id:'new',name:'重新命名',currency:'TWD'});
 assert.equal(d.accounts.length,2);
 d.fills=[fill()];
 assert.equal(selectTradingAccount(d,'AAPL','USD').id,'broker');
 assert.throws(()=>saveTradingAccount(d,{...d.accounts[0],disabled:true}),/持倉/);
 d.fills.push({...fill(),id:'f2',accountId:'new'});
 assert.equal(selectTradingAccount(d,'AAPL','USD'),null);
 assert.equal(selectTradingAccount(d,'AAPL','USD','new').id,'new');
 assert.equal(resolveSymbolMarket({...d,fills:[{...fill(),symbol:'2330',market:'TWSE'}]},'2330',undefined),'TWSE');
});
test('editing recalculates settlement and replaces cash effect, never preserves stale total',()=>{
 const f=fill();f.settlement=buildSettlement(f,fx());
 const d={...data(),fills:[f]};
 const next=updateRecordedFill(d,f,{...f,quantity:20,settlement:fx()},now);
 assert.equal(next.fills[0].settlement.total,64032);
 assert.deepEqual(buildCurrentEquity(next,{},32,new Date(now)).cashByCurrency,{TWD:-64032});
 assert.equal(d.fills[0].settlement.total,32032);
 assert.throws(()=>updateRecordedFill(d,f,{...f,settlement:undefined},now),/交割|幣別/);
});
