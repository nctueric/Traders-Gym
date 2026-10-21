/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import {useEffect,useRef,useState} from 'react';
import {buildSettlement} from '@/lib/trade-settlement.mjs';
import {marketCurrency,marketDate} from '@/lib/trade-entry.mjs';
import {resolveSymbolMarket} from '@/lib/simple-entry.mjs';
import {selectTradingAccount} from '@/lib/trading-accounts.mjs';
import {USDTWD_SYMBOL} from '@/lib/quote-engine.mjs';
import {TradingAccounts} from './trading-accounts';

export function EntrySettlement({data,value,onChange,quotes={},fetcher=fetch,now,onAccountSave}:any){
 const changeRef=useRef(onChange),currentRef=useRef(value);
 useEffect(()=>{changeRef.current=onChange;currentRef.current=value;},[onChange,value]);
 const [lookup,setLookup]=useState<any>({}),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const symbol=String(value.symbol||'').trim().toUpperCase();
 const resolved=value.market||resolveSymbolMarket(data,symbol,undefined,{...quotes,...lookup});
 const account=selectTradingAccount(data,symbol,resolved?marketCurrency(resolved):'',value.accountId);
 const native=resolved?marketCurrency(resolved):'';
 const date=value.date||(value.timestamp&&resolved?marketDate(value.timestamp,resolved):'');
 const currency=value.settlement?.currency||account?.currency||native;
 const mode=value.settlement?.mode||'AUTO';
 const feeCurrency=value.settlement?.feeCurrency||native;
 const cross=!!native&&(currency!==native||feeCurrency!==native);
 const rateReady=!!value.settlement?.rateDate&&value.settlement?.forDate===date&&value.settlement?.rate>0;
 useEffect(()=>{
  if(!symbol||resolved||!/^[A-Z0-9.^=-]{1,20}$/.test(symbol))return;
  const abort=new AbortController();
  const candidates=/^[0-9]/.test(symbol)&&!symbol.includes('.')?[symbol+'.TW',symbol+'.TWO']:[symbol];
  const timer=setTimeout(()=>{void fetcher('/api/quotes?symbols='+encodeURIComponent(candidates.join(',')),{signal:abort.signal}).then(async(r:Response)=>{if(!r.ok)throw Error();const body=await r.json();if(!abort.signal.aborted)setLookup(Object.fromEntries((body.quotes||[]).map((q:any)=>[q.symbol,q])));}).catch(()=>{});},400);
  return()=>{abort.abort();clearTimeout(timer);};
 },[symbol,resolved,fetcher]);
 useEffect(()=>{
  if(!resolved)return;
  const v=currentRef.current,patch:any={};
  if(!v.market)patch.market=resolved;
  if(!v.accountId&&account)patch.accountId=account.id;
  if(!v.timestamp&&(!v.date||(!v.dateManual&&v.dateMarket&&v.dateMarket!==resolved))){patch.date=marketDate(now||new Date().toISOString(),resolved);patch.dateMarket=resolved;}
  if(!v.settlement)patch.settlement={currency,mode:'AUTO',feeCurrency:native};
  if(Object.keys(patch).length)changeRef.current(patch);
 },[resolved,account,currency,native,now]);
 useEffect(()=>{
  if(!cross||mode!=='AUTO'||!date)return;
  const v=currentRef.current;
  if(v.settlement?.rateDate&&v.settlement?.forDate===date&&v.settlement?.rate>0)return;
  const abort=new AbortController();
  void (async()=>{
   try{
    const today=marketDate(now||new Date().toISOString(),resolved);
    let rate,rateDate,source;
    if(date===today){
     const response=await fetcher('/api/quotes?symbols='+encodeURIComponent(USDTWD_SYMBOL),{signal:abort.signal});
     if(!response.ok)throw Error();const body=await response.json();
     const q=(body.quotes||[]).find((q:any)=>q.symbol===USDTWD_SYMBOL);
     if(!(q?.price>0)||!q.updatedAt||!Number.isFinite(Date.parse(q.updatedAt))||Date.parse(q.updatedAt)>Date.now()+60000||Date.now()-Date.parse(q.updatedAt)>7*86400000)throw Error();
     rate=q.price;rateDate=q.updatedAt;source='市場參考匯率';
    }else{
     const start=new Date(Date.parse(date+'T12:00:00Z')-14*86400000).toISOString().slice(0,10);
     const response=await fetcher('/api/history?'+new URLSearchParams({symbol:USDTWD_SYMBOL,start,end:date,priceBasis:'raw'}),{signal:abort.signal});
     if(!response.ok)throw Error();const body=await response.json();
     const bar=(body.bars||[]).filter((b:any)=>b.date<=date&&b.close>0).sort((a:any,b:any)=>b.date.localeCompare(a.date))[0];
     if(!bar||bar.date<start)throw Error();rate=bar.close;rateDate=bar.date;source='歷史參考匯率';
    }
    if(!abort.signal.aborted){setError('');changeRef.current({settlement:{...currentRef.current.settlement,rate,rateDate,source,forDate:date}});}
   }catch{if(!abort.signal.aborted)setError('未取得匯率，請重試或改用手動匯率');}
  })();
  return()=>abort.abort();
 },[cross,mode,date,resolved,currency,rateReady,fetcher,now,retry]);
 const update=(patch:any)=>onChange({settlement:{...value.settlement,currency,mode,feeCurrency,...patch},needsReview:!!value.price});
 let preview:any=null;
 try{if(native&&!(cross&&mode==='AUTO'&&!rateReady))preview=buildSettlement({...value,currency:native},{...value.settlement,currency,mode,feeCurrency,feeAmount:value.fee});}catch{/* Incomplete draft stays editable. */}
 return <div className="entry-settlement">
 <div className="form-grid">
 <label>市場<select value={resolved||''} onChange={e=>onChange({market:e.target.value,accountId:value.accountManual?value.accountId:'',settlement:undefined,confirmedKey:'',needsReview:!!value.price})}><option value="">請確認市場</option>{['TWSE','TPEX','NASDAQ','NYSE','AMEX'].map(m=><option key={m}>{m}</option>)}</select></label>
 <label>交易帳戶<select value={value.accountId||account?.id||''} onChange={e=>onChange({accountId:e.target.value,accountManual:true,settlement:undefined,confirmedKey:'',needsReview:!!value.price})}><option value="">請選擇帳戶</option>{data.accounts.filter((a:any)=>!a.disabled).map((a:any)=><option key={a.id} value={a.id}>{a.name} · 交割 {a.currency}</option>)}</select></label>
 </div>
 {onAccountSave&&<TradingAccounts compact data={data} onSave={onAccountSave} onCreated={(id:string)=>onChange({accountId:id,accountManual:true,settlement:undefined})}/>}
 {native&&<><p>成交原幣 {native} · 成交即交割記帳</p><details><summary>交割與匯率設定 · {currency}</summary><div className="form-grid">
 <label>扣款／入帳幣別<select value={currency} onChange={e=>update({currency:e.target.value,rate:undefined,rateDate:undefined})}>{['TWD','USD'].map(c=><option key={c}>{c}</option>)}</select></label>
 <label>手續費幣別<select value={feeCurrency} onChange={e=>update({feeCurrency:e.target.value})}>{['TWD','USD'].map(c=><option key={c}>{c}</option>)}</select></label>
 <label>換算方式<select value={mode} onChange={e=>update({mode:e.target.value,rateDate:undefined})}><option value="AUTO">自動匯率</option><option value="RATE">手動匯率</option><option value="TOTAL">實際交割總額</option></select></label>
 {cross&&(mode==='RATE'||mode==='TOTAL'&&currency===native)&&<label>1 USD＝多少 TWD<input type="number" min="0" step="any" inputMode="decimal" value={value.settlement?.rate??''} onChange={e=>update({rate:e.target.value})}/></label>}
 {mode==='TOTAL'&&<label>實際交割總額（含手續費）{currency}<input type="number" min="0" step="any" inputMode="decimal" value={value.settlement?.total??''} onChange={e=>update({total:e.target.value})}/></label>}
 </div></details>
 <p role="status">{preview?((mode==='AUTO'?'參考換算・':'')+(value.side==='SELL'?'入帳 ':'扣款 ')+preview.currency+' '+preview.total.toLocaleString('zh-TW')+'（含手續費）'):'填妥成交資料與匯率後顯示交割金額'}</p>
 {cross&&value.settlement?.rateDate&&<small>1 USD＝{value.settlement.rate} TWD · {value.settlement.rateDate}</small>}
 {error&&cross&&mode==='AUTO'&&<p role="alert">{error} <button type="button" className="ghost" onClick={()=>setRetry(v=>v+1)}>重試匯率</button></p>}
 </>}
 </div>;
}
