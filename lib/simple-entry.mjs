import { marketDate, marketCurrency, previewEntry, appendValidatedFills } from './trade-entry.mjs';
import { reconcileBackdatedCycles } from './cycle-rebuild.mjs';
import { durableTradeJson } from './trade-record-store.mjs';

export const ENTRY_MARKETS=['NASDAQ','NYSE','AMEX','TWSE','TPEX'];
export const newSimpleRow=()=>({id:`fill-${globalThis.crypto.randomUUID()}`,symbol:'',side:'BUY',quantity:'',price:'',fee:'0',market:''});
export function createSimpleDraft(accounts,now=new Date().toISOString()) {
 const account=accounts[0];
 return {id:`batch-${globalThis.crypto.randomUUID()}`,accountId:account?.id||'',date:marketDate(now,account?.currency==='TWD'?'TWSE':'NASDAQ'),rows:[newSimpleRow()]};
}
export function resolveSymbolMarket(data,symbol,currency,quotes={}) {
 const value=String(symbol||'').trim().toUpperCase();
 const known=[...new Set((data.fills||[]).filter(f=>f.symbol===value&&marketCurrency(f.market)===currency).map(f=>f.market))];
 if(known.length===1)return known[0];
 if(known.length>1)return '';
 const exchanges={NMS:'NASDAQ',NGM:'NASDAQ',NCM:'NASDAQ',NASDAQ:'NASDAQ',NYQ:'NYSE',NYSE:'NYSE',ASE:'AMEX',AMEX:'AMEX',TAI:'TWSE',TWO:'TPEX',TWSE:'TWSE',TPEX:'TPEX'};
 const found=Object.values(quotes).filter(q=>q.symbol===value||q.symbol===`${value}.TW`||q.symbol===`${value}.TWO`).map(q=>exchanges[q.exchange]).filter(m=>m&&marketCurrency(m)===currency);
 return new Set(found).size===1?found[0]:'';
}
export function simpleTimestamp(date,market,now=new Date().toISOString()) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)!==date)throw Error('成交日期無效');
 const today=marketDate(now,market);
 if(date>today)throw Error('只能登錄已發生的成交，不能使用未來日期');
 if(date===today)return {timestamp:new Date(now).toISOString(),timeSource:'SUBMISSION_TIME'};
 const zone=marketCurrency(market)==='TWD'?'Asia/Taipei':'America/New_York';
 const clock=zone==='Asia/Taipei'?'13:30:00':'16:00:00';
 const wall=Date.parse(`${date}T${clock}Z`);let instant=wall;
 for(let i=0;i<3;i++){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
  const rendered=Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  instant+=wall-rendered;
 }
 return {timestamp:new Date(instant).toISOString(),timeSource:'STANDARD_CLOSE'};
}
export const simpleTimeLabel=source=>source==='STANDARD_CLOSE'?'一般收盤時間代填':source==='SUBMISSION_TIME'?'提交時刻代填':'';
const blank=row=>!String(row.symbol||'').trim()&&!String(row.quantity||'').trim()&&!String(row.price||'').trim()&&Number(row.fee||0)===0;
export function previewSimpleBatch(data,batch,now=new Date().toISOString()) {
 const errors=[],rows=[],fills=[],seen=new Set();
 const account=data.accounts.find(a=>a.id===batch.accountId);
 if(!account)errors.push({rowId:'',message:'請選擇交易帳戶'});
 if(!Array.isArray(batch.rows)||batch.rows.length>100)errors.push({rowId:'',message:'每批最多 100 筆'});
 let virtual=data;
 for(const row of (batch.rows||[]).slice(0,100)){
  if(blank(row))continue;
  try{
   if(seen.has(row.id))throw Error('成交識別碼重複');seen.add(row.id);
   const market=row.market||resolveSymbolMarket(data,row.symbol,account?.currency);
   if(!ENTRY_MARKETS.includes(market))throw Error('請確認標的市場');
   const timing=simpleTimestamp(batch.date,market,now);
   const p=previewEntry(virtual,{...row,accountId:batch.accountId,market,timestamp:timing.timestamp},now);
   if(p.errors.length)throw Error(p.errors.join('；'));
   const fill={...p.fill,entryMode:'SIMPLE',batchId:batch.id,timeSource:timing.timeSource,tradeDate:batch.date};
   const duplicate=virtual.fills.some(f=>f.accountId===fill.accountId&&f.symbol===fill.symbol&&f.side===fill.side&&f.quantity===fill.quantity&&f.price===fill.price&&f.fee===fill.fee&&marketDate(f.timestamp,f.market)===batch.date);
   rows.push({id:row.id,fill,action:p.action,before:p.before?.quantity||0,after:p.after?.quantity||0,affected:p.affected,duplicate});fills.push(fill);
   virtual={...virtual,fills:[...virtual.fills,fill]};
  }catch(e){errors.push({rowId:row.id,message:e.message});}
 }
 if(!rows.length&&!errors.length)errors.push({rowId:'',message:'請至少輸入一筆成交'});
 const {entryDraft:_full,simpleEntryDraft:_simple,...baseline}=data;void _full;void _simple;
 return {errors,rows,fills,confirmationKey:errors.length?'':JSON.stringify([batch,durableTradeJson(baseline),rows.map(r=>r.fill.timeSource)])};
}
export function commitSimpleBatch(data,batch,confirmationKey,now=new Date().toISOString()) {
 const preview=previewSimpleBatch(data,batch,now);
 if(preview.errors.length)throw Error(preview.errors.map(e=>e.message).join('；'));
 if(!confirmationKey||confirmationKey!==preview.confirmationKey)throw Error('日期或帳本內容已變更，請重新查看並確認整批成交');
 const {simpleEntryDraft:_draft,...rest}=data;void _draft;
 // Only fills are added. No fabricated plans, strategy selections or evidence.
 return reconcileBackdatedCycles(data,{...rest,fills:appendValidatedFills(data,preview.fills)},batch.id,now);
}
