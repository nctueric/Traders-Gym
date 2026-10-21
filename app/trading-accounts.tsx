/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import {useState,useRef} from 'react';
export function TradingAccounts({data,onSave,onDefaults,onCreated,compact=false}:any){
 const [form,setForm]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const guard=useRef(false);
 const save=async()=>{if(guard.current)return;guard.current=true;setBusy(true);setError('');try{await onSave(form);onCreated?.(form.id);setForm(null);}catch(e){setError(e instanceof Error?e.message:'儲存失敗，請重試');}finally{guard.current=false;setBusy(false);}};
 return <section className={compact?'trading-account-inline':'panel'} aria-label="交易帳戶管理">
 {!compact&&<><h2>交易帳戶</h2><p>同一券商帳戶可持有台幣及美元；預設交割幣別只影響新交易，不改寫歷史金額。</p>
 {data.accounts.map((a:any)=><div className="panel-head" key={a.id}><span>{a.name} · 預設交割 {a.currency}{a.disabled?' · 已停用':''}</span><button type="button" className="ghost" onClick={()=>{setForm({...a});setError('');}}>編輯帳戶</button></div>)}
 {onDefaults&&<div className="form-grid">{['TWD','USD'].map(currency=><label key={currency}>{currency==='TWD'?'台股':'美股'}預設帳戶<select value={data.settings?.entryAccounts?.[currency]||''} onChange={e=>void onDefaults(currency,e.target.value).catch((e:Error)=>setError(e.message))}><option value="">自動配對／每次選擇</option>{data.accounts.filter((a:any)=>!a.disabled).map((a:any)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>)}</div>}</>}
 {!form&&<button type="button" className="ghost" onClick={()=>setForm({id:crypto.randomUUID(),name:'',currency:'TWD'})}>新增交易帳戶</button>}
 {form&&<div className="form-grid"><label>帳戶名稱<input maxLength={80} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>預設交割幣別<select value={form.currency} onChange={e=>setForm({...form,currency:e.target.value})}><option value="TWD">台幣 TWD</option><option value="USD">美元 USD</option></select></label>
 {data.accounts.some((a:any)=>a.id===form.id)&&<label><input type="checkbox" checked={!!form.disabled} onChange={e=>setForm({...form,disabled:e.target.checked})}/>停用（有持倉時不可停用）</label>}
 <div className="actions"><button type="button" className="primary" disabled={busy} onClick={()=>void save()}>{busy?'儲存中…':'儲存帳戶'}</button><button type="button" className="ghost" disabled={busy} onClick={()=>setForm(null)}>取消</button></div></div>}
 {error&&<p role="alert">{error}</p>}
 </section>;
}
