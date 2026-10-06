"use client";
import { useCallback, useEffect, useState } from "react";
type Row = { id: number; accountId:string;accountName:string;version: number; createdAt: string; sizeBytes: number; pinned?: number; isCurrent?: number };
type Preview = { items: Row[]; bytes: number; batchLimit: number; removable?:number; retained?:number };
export function HistoryPanel({ sessionId }: { sessionId: string }) {
  const [rows,setRows]=useState<Row[]>([]),[next,setNext]=useState<number|null>(null),[preview,setPreview]=useState<Preview|null>(null);
  const [retentionEnabled,setRetentionEnabled]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [restore,setRestore]=useState<{row:Row;baseVersion:number}|null>(null);
  const request=useCallback(async(action:string,body?:unknown)=>{
    const response=await fetch(`/api/admin/history?action=${action}`,{method:body?'POST':'GET',cache:'no-store',headers:{'x-workspace-session':sessionId,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok){const data=await response.json();throw new Error(data.error || '版本操作失敗');}
    return response;
  },[sessionId]);
  const load=useCallback(async(before?:number)=>{
    const data=await (await request(`list${before?`&before=${before}`:''}`)).json();
    setRetentionEnabled(data.retentionEnabled===true);setRows(current=>before?[...current,...data.items]:data.items);setNext(data.nextBefore);
  },[request]);
  useEffect(()=>{let active=true;const timer=setTimeout(()=>void load().catch(e=>{if(active)setError(e.message);}),0);return()=>{active=false;clearTimeout(timer);};},[load]);
  async function run(task:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setMessage('');try{await task();}catch(e){setError(e instanceof Error?e.message:'操作失敗');}finally{setBusy(false);}}
  async function download(row:Row){const response=await request(`download&id=${row.id}`);const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=`trade-review-v${row.version}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('完整版本已下載。');}
  async function prepareRestore(row:Row){
    const response=await fetch(`/api/trade-records?accountId=${encodeURIComponent(row.accountId)}`,{cache:'no-store',headers:{'x-workspace-session':sessionId}});const data=await response.json();if(!response.ok)throw new Error(data.error || '無法確認目前版本');setRestore({row,baseVersion:data.account.version});setPreview(null);
  }
  return <section className="admin-results" aria-label="我的帳本歷史版本" aria-busy={busy}>
    <h2>我的帳本歷史版本</h2>
    <p>每日保留規則：依台北日期，保留今天與前六天，每天最後一個成功版本；目前帳本始終保留。僅清理備份快照，不刪除交易或複盤內容。</p><p role="status">{retentionEnabled?"每日保留已啟用；成功儲存後整理，每小時清理過期版本。":"每日保留尚未啟用，目前只提供新規則預覽。既有備份尚未清除。"}</p>
    <p>此處只管理你的帳本。還原前請保存其他分頁的修改，再關閉其他交易工作區。</p>
    {error&&<p className="account-alert" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <div className="account-actions"><button disabled={busy} onClick={()=>void run(()=>load())}>重新整理</button><button disabled={busy} onClick={()=>void run(async()=>{setPreview(await(await request('retention-preview')).json());setRestore(null);})}>預覽可清理版本</button></div>
    {preview&&<section aria-label="清理確認"><h3>可清理 {preview.removable ?? preview.items.length} 個版本，保留 {preview.retained ?? "—"} 個</h3><p>本批最多 50 個；全部可清理版本預估容量 {(preview.bytes/1e6).toFixed(2)} MB。清理後無法從網站還原這些版本；如需保留請先下載。執行時會再次核對保留規則。</p><ul>{preview.items.map(r=><li key={r.id}>v{r.version} · {new Date(r.createdAt).toLocaleString('zh-TW')}</li>)}</ul><button disabled={busy||!retentionEnabled||!preview.items.length} onClick={()=>void run(async()=>{const result=await(await request('cleanup',{ids:preview.items.map(r=>r.id)})).json();setMessage(`${result.message}：移除 ${result.removed} 個版本，釋放 ${(result.reclaimedBytes/1e6).toFixed(2)} MB。`);setPreview(null);await load();})}>確認清理本批</button><button disabled={busy} onClick={()=>setPreview(null)}>取消</button></section>}
    {restore&&<section aria-label="還原確認"><h3>將 v{restore.row.version} 還原成新版本</h3><p>還原會建立新版本，並依每日規則保留；如需另存目前 v{restore.baseVersion}，請先下載備份。還原後重新開啟交易工作區。若確認期間有新修改，系統會停止還原。</p><button disabled={busy} onClick={()=>void run(async()=>{const result=await(await request('restore',{id:restore.row.id,baseVersion:restore.baseVersion})).json();setMessage(`已建立 v${result.account.version}。請重新開啟交易工作區。`);setRestore(null);await load();})}>確認建立還原版本</button><button disabled={busy} onClick={()=>setRestore(null)}>取消</button></section>}
    {!rows.length?<p>尚無歷史版本。雲端帳本成功儲存後會開始記錄。</p>:<div className="admin-table-wrap"><table><thead><tr><th>帳本／版本</th><th>時間</th><th>大小</th><th>保留狀態</th><th>操作</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td data-label="版本">{row.accountName} · v{row.version}</td><td data-label="時間">{new Date(row.createdAt).toLocaleString('zh-TW')}</td><td data-label="大小">{(row.sizeBytes/1e6).toFixed(2)} MB</td><td data-label="狀態">{row.isCurrent?'目前帳本':row.pinned&&!retentionEnabled?'首次升級保留版':'每日歷史版本'}</td><td data-label="操作"><button disabled={busy} onClick={()=>void run(()=>download(row))}>下載</button><button disabled={busy||!!row.isCurrent} onClick={()=>void run(()=>prepareRestore(row))}>還原</button></td></tr>)}</tbody></table></div>}
    {next&&<button disabled={busy} onClick={()=>void run(()=>load(next))}>載入較早版本</button>}
  </section>;
}
