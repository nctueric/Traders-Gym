/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import {useState} from 'react';
import {legacyBrowserRecords,differsFromCloud} from '@/lib/legacy-records.mjs';
export function LegacyRecords({userId,fetcher,cloudDataset}:{userId:string;fetcher:typeof fetch;cloudDataset:any}){
 const [rows,setRows]=useState<any[]|null>(null),[status,setStatus]=useState('');
 async function inspect(){setStatus('正在唯讀檢查舊資料…');let browser=[];try{browser=legacyBrowserRecords(localStorage,userId);}catch{/* No browser persistence required. */}
  try{const response=await fetcher('/api/legacy-records');if(!response.ok)throw Error('伺服器舊檔案檢查失敗');const result=await response.json();setRows([...browser,...result.records]);setStatus('只顯示可確認擁有者的舊資料；不覆蓋雲端、不刪除舊檔。');}catch(e){setRows(browser);setStatus(e instanceof Error?e.message:'舊資料檢查失敗');}}
 function download(row:any){const url=URL.createObjectURL(new Blob([JSON.stringify(row.dataset,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='legacy-trade-review.json';link.click();URL.revokeObjectURL(url);}
 return <details className="panel"><summary>舊本機資料轉移</summary><p>先匯出舊資料，再使用下方原有匯入流程選擇雲端帳本並確認取代。</p><button className="ghost" onClick={()=>void inspect()}>唯讀檢查舊資料</button>{status&&<p role="status">{status}</p>}{rows?.map((row:any)=><div key={row.id}><b>{row.name}</b><p>{row.source}・版本 {row.version??'未知'}・成交 {row.dataset.fills.length} 筆・{differsFromCloud(row.dataset,cloudDataset)?'與目前雲端不同':'與目前雲端相同'}</p><button onClick={()=>download(row)}>匯出這份舊資料</button></div>)}{rows?.length===0&&<p>沒有找到可確認擁有者的舊本機帳本。</p>}</details>;
}
