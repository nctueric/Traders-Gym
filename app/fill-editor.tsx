"use client";
import {useRef,useState} from 'react';
import {DialogFrame} from './workspace-ui';
type Fill={id:string;accountId:string;symbol:string;market:string;currency:string;side:'BUY'|'SELL';quantity:number;price:number;fee:number;timestamp:string;note?:string};
type Account={id:string;name:string;currency:string};
const localTime=(time:string)=>{const date=new Date(time);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,23);};
export function FillEditor({fill,accounts,onSave,onClose}:{fill:Fill;accounts:Account[];onSave:(draft:Record<string,string>)=>Promise<void>;onClose:()=>void}) {
 const [form,setForm]=useState(()=>({accountId:fill.accountId,market:fill.market,symbol:fill.symbol,side:String(fill.side),quantity:String(fill.quantity),price:String(fill.price),fee:String(fill.fee),timestamp:localTime(fill.timestamp),note:fill.note||''}));
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),saving=useRef(false);
 const field=(key:keyof typeof form,value:string)=>setForm(current=>({...current,[key]:value}));
 return <DialogFrame label={`編輯 ${fill.symbol} 成交`} onClose={()=>{if(!busy)onClose();}}><form className="modal fill-editor" onSubmit={async event=>{event.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setError('');try{await onSave(form);onClose();}catch(cause){setError(cause instanceof Error?cause.message:'儲存失敗，輸入已保留');}finally{saving.current=false;setBusy(false);}}}>
  <header className="panel-head"><h2>編輯成交</h2><button type="button" className="ghost" disabled={busy} onClick={onClose}>取消</button></header>
  <p className="modal-copy">儲存後會依修改後的成交順序重新計算持倉、交易閉環與績效。</p>
  <div className="form-grid"><label>交易帳戶<select required value={form.accountId} onChange={e=>field('accountId',e.target.value)}>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}（{account.currency}）</option>)}</select></label>
  <label>市場<select required value={form.market} onChange={e=>field('market',e.target.value)}>{['NASDAQ','NYSE','AMEX','TWSE','TPEX'].map(market=><option key={market} value={market}>{market}</option>)}</select></label>
  <label>標的代號<input required maxLength={20} autoCapitalize="characters" value={form.symbol} onChange={e=>field('symbol',e.target.value)}/></label>
  <label>買賣方向<select value={form.side} onChange={e=>field('side',e.target.value)}><option value="BUY">買進／回補</option><option value="SELL">賣出／放空</option></select></label>
  <label>股數<input required type="number" inputMode="decimal" min="0.00000001" step="any" value={form.quantity} onChange={e=>field('quantity',e.target.value)}/></label>
  <label>成交價<input required type="number" inputMode="decimal" min="0.00000001" step="any" value={form.price} onChange={e=>field('price',e.target.value)}/></label>
  <label>手續費<input required type="number" inputMode="decimal" min="0" step="any" value={form.fee} onChange={e=>field('fee',e.target.value)}/></label>
  <label>成交時間（裝置當地時間）<input required type="datetime-local" step="0.001" value={form.timestamp} onChange={e=>field('timestamp',e.target.value)}/></label>
  <label className="wide">備註（選填）<input maxLength={2000} value={form.note} onChange={e=>field('note',e.target.value)}/></label></div>
  {error&&<p role="alert" className="account-alert">{error}</p>}
  <div className="modal-actions"><button type="button" className="ghost" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy}>{busy?'儲存中…':'儲存修改'}</button></div>
 </form></DialogFrame>;
}
