"use client";
import { useEffect,useState } from 'react';
export function LedgerPanel({sessionId}:{sessionId:string}) {
  const [accounts,setAccounts]=useState<{id:string;name:string;version:number}[]>([]),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();void fetch('/api/admin/ledgers',{cache:'no-store',signal:controller.signal,headers:{'x-workspace-session':sessionId}}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'帳本讀取失敗');setAccounts(data.accounts);}).catch(error=>{if(!controller.signal.aborted)setError(error.message);});return()=>controller.abort();},[sessionId]);
  return <section className="admin-results"><h2>選擇帳本</h2><p>測試帳本與標準歷史帳本分開保存。標準歷史帳本是原始資料的副本，可編輯；匯入時的版本另行保護。</p>{error&&<p role="alert">{error}</p>}<ul>{accounts.map(account=><li key={account.id}><a href={`/?accountId=${encodeURIComponent(account.id)}`}>{account.name}</a> · v{account.version}</li>)}</ul></section>;
}
