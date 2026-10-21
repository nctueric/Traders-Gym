/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import {useWorkspacePreferences} from './workspace-preferences';
import {useRef,useState} from 'react';
import {EntrySettlement} from './entry-settlement';
import {SymbolInput} from './symbol-input';
import {TradeEntryWorkspace} from './trade-entry-workspace';
import {InfoPopover} from './info-popover';
import {ACTION_LABELS,marketDate,marketCurrency} from '@/lib/trade-entry.mjs';
import {newSimpleRow,previewSimpleBatch,simpleTimeLabel} from '@/lib/simple-entry.mjs';

export function TradeRegistration({data,quotes,onFullChange,onFullSubmit,onSimpleChange,onSimpleSubmit,onBack,fetcher=fetch,now,ledgerVersion,onAccountSave}:any){
 const {preferences,ready,update}=useWorkspacePreferences();const mode=preferences.entryMode;
 const changeMode=(value:string)=>{void update({entryMode:value}).catch(()=>{});};
 return <section className="registration-workspace"><div className="registration-toolbar"><div role="group" aria-label="登錄模式">{[['simple','簡易登錄'],['full','完整登錄']].map(([key,label])=><button type="button" key={key} className="ghost" disabled={!ready} aria-pressed={mode===key} onClick={()=>changeMode(key)}>{label}</button>)}</div><InfoPopover label="交易登錄" mobilePresentation="sheet"><p>只記錄已成交交易，不會送出券商訂單。簡易模式可一次登錄不同市場、帳戶的多筆成交；策略與計畫可之後補充。</p><p>補登依成交順序重算 FIFO 與閉環。原註記保留；無法明確對應的資料可在「成交與資金 → 資料檢查」核對。</p><p>切換模式保留各自草稿。雲端是正式帳本；當頁修改會先保存在此裝置，再於背景同步，仍可匯出 JSON 備份。</p></InfoPopover><button className="ghost registration-back" type="button" onClick={onBack}>返回總覽</button></div>{mode==='full'?<TradeEntryWorkspace data={data} draft={data.entryDraft} quotes={quotes} onChange={onFullChange} onSubmit={onFullSubmit} onBack={onBack} fetcher={fetcher} now={now} onAccountSave={onAccountSave}/>:<SimpleEntry data={data} batch={data.simpleEntryDraft} onChange={onSimpleChange} onSubmit={onSimpleSubmit} quotes={quotes} fetcher={fetcher} now={now} ledgerVersion={ledgerVersion} onAccountSave={onAccountSave}/>}</section>;
}
function SimpleEntry({data,batch,onChange,onSubmit,quotes,fetcher,now,ledgerVersion,onAccountSave}:any){
 const [preview,setPreview]=useState<any>(null),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false);
 const guard=useRef(false);
 if(!batch)return <p>正在準備登錄表單…</p>;
 const effective={...batch,rows:batch.rows.map((r:any)=>({...r,accountId:r.accountId??(batch.formatVersion===2?'':batch.accountId),date:r.date||(batch.formatVersion===2?'':batch.date)}))};
 const change=(next:any)=>{setPreview(null);setConfirmed(false);setError('');onChange(next);};
 const rowChange=(id:string,patch:any)=>{setPreview(null);setConfirmed(false);setError('');onChange((current:any)=>({...current,rows:current.rows.map((r:any)=>r.id===id?{...r,...patch}:r)}));};
 const inspect=()=>{const p=previewSimpleBatch(data,effective,now||new Date().toISOString());setPreview({...p,ledgerVersion});setConfirmed(false);setError('');};
 const submit=async()=>{if(guard.current||!confirmed)return;guard.current=true;setBusy(true);try{await onSubmit(effective,preview.confirmationKey,preview.ledgerVersion);}catch(e){setError(e instanceof Error?e.message:'登錄失敗');setConfirmed(false);}finally{guard.current=false;setBusy(false);}};
 return <form className="simple-entry" noValidate onSubmit={e=>{e.preventDefault();if(preview?.confirmationKey&&confirmed)void submit();else inspect();}}>
 <p>依標的原幣成交；交割金額自動換算，可自行修改。</p>
 <label>套用同一成交日期<input type="date" value={batch.date||''} onChange={e=>change({...effective,date:e.target.value,rows:effective.rows.map((r:any)=>({...r,date:e.target.value,dateManual:true,settlement:r.settlement?{...r.settlement,rateDate:undefined}:undefined}))})}/></label>
 <div className="simple-entry-rows">{effective.rows.map((row:any,index:number)=>{
 const currency=row.market?marketCurrency(row.market):'待確認';
 return <fieldset className="simple-entry-row" key={row.id}><legend>第 {index+1} 筆成交</legend>
<label htmlFor={`simple-symbol-${row.id}`}>標的<SymbolInput id={`simple-symbol-${row.id}`} key={batch.id+':'+row.id} aria-label={`第 ${index+1} 筆標的`} placeholder="2330 / AAPL" value={row.symbol} onCommit={symbol=>rowChange(row.id,{symbol,market:'',accountId:row.accountManual?row.accountId:'',settlement:undefined,needsReview:!!row.price})}/></label>
 <label>買賣<select value={row.side} onChange={e=>rowChange(row.id,{side:e.target.value,needsReview:!!row.settlement?.total})}><option value="BUY">買進／回補</option><option value="SELL">賣出／放空</option></select></label>
 <EntrySettlement data={data} value={row} onChange={(patch:any)=>rowChange(row.id,patch)} quotes={quotes} fetcher={fetcher} now={now} onAccountSave={onAccountSave}/>
 <label>成交日期（{currency==='TWD'?'台北':'紐約'}）<input type="date" value={row.date||''} max={row.market?marketDate(now||new Date().toISOString(),row.market):undefined} onChange={e=>rowChange(row.id,{date:e.target.value,dateManual:true})}/></label>
 {[['quantity','股數'],['price',`成交價 (${currency})`],['fee',`手續費 (${row.settlement?.feeCurrency||currency})`]].map(([key,label])=><label key={key}>{label}<input type="number" inputMode="decimal" min="0" step="any" value={row[key]} onChange={e=>rowChange(row.id,{[key]:e.target.value})}/></label>)}
 {row.needsReview&&<label className="entry-warning"><input type="checkbox" checked={false} onChange={()=>rowChange(row.id,{needsReview:false})}/>標的或交割條件已改變，確認現有金額正確</label>}
 <button type="button" className="ghost" onClick={()=>change({...effective,rows:batch.rows.length===1?[newSimpleRow()]:effective.rows.filter((r:any)=>r.id!==row.id)})}>刪除第 {index+1} 筆</button>
 {preview?.errors.filter((e:any)=>e.rowId===row.id).map((e:any)=><p role="alert" key={e.message}>{e.message}</p>)}
 </fieldset>;})}</div>
 {preview?.errors.filter((e:any)=>!e.rowId).map((e:any)=><p role="alert" key={e.message}>{e.message}</p>)}
 {preview?.confirmationKey&&<section className="simple-confirmation" aria-label="整批成交確認"><h3>確認 {preview.rows.length} 筆成交</h3><ol>{preview.rows.map((r:any)=><li key={r.id}><b>{r.fill.symbol} · {ACTION_LABELS[r.action as keyof typeof ACTION_LABELS]}</b><span>{data.accounts.find((a:any)=>a.id===r.fill.accountId)?.name} · {r.fill.market} · {r.fill.tradeDate}</span><span>{r.fill.quantity} 股 × {r.fill.currency} {r.fill.price} · 手續費 {r.fill.settlement?.feeCurrency||r.fill.currency} {r.fill.settlement?.feeAmount??r.fill.fee}</span>{r.fill.settlement&&<span>交割 {r.fill.settlement.currency} {r.fill.settlement.total}（含費用）</span>}<span>{r.before} → {r.after} 股 · {simpleTimeLabel(r.fill.timeSource)}</span>{r.duplicate&&<strong className="entry-warning">疑似重複成交，請核對</strong>}{r.affected.length>0&&<strong className="entry-warning">補登將調整既有閉環，原註記保留供核對</strong>}</li>)}</ol><label className="entry-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>確認以上成交、交割金額及補登影響</label></section>}
 {error&&<p role="alert">{error}</p>}<footer className="simple-entry-actions"><button type="button" className="ghost" disabled={batch.rows.length>=100||busy} onClick={()=>change({...effective,rows:[...effective.rows,newSimpleRow()]})}>新增一筆</button><button className="primary" type="submit" disabled={busy||!!preview?.confirmationKey&&!confirmed}>{busy?'登錄中…':preview?.confirmationKey?'確認登錄':'核對成交'}</button><small>{batch.rows.length} / 100 筆</small></footer>
 </form>;
}
export function CycleRebuildHistory({records=[]}:any){return <details className="panel"><summary>補登與閉環重算紀錄・{records.length} 次</summary>{[...records].reverse().map((record:any)=><details key={record.id}><summary>{new Date(record.timestamp).toLocaleString('zh-TW')} · {record.changes.length} 個調整</summary>{record.changes.map((c:any)=><p key={c.from}>{c.symbol} · {c.automatic?'已對應':'待核對'} · {c.from} → {c.to.join('、')||'無單一對應'}</p>)}<details><summary>原始註記備份</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(record.original,null,2)}</pre></details></details>)}</details>;}
