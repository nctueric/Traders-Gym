import {useState,useEffect,useRef} from "react";
import { createRoot } from "react-dom/client";
import { AdminWorkspace } from "../app/admin/admin-workspace";
import TradeWorkspace from "../app/trade-workspace";
import "../app/globals.css";
import "../app/account.css";
import "../app/workbench.css";
import "../app/mobile.css";
import "../app/form-controls.css";

// Only bundled by serve-ui-fixture.mjs, never imported by application routes.
// A fresh ephemeral origin isolates browser storage and every request stays local.
const scenario = new URL(location.href).searchParams.get("scenario") || "rich";
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.origin !== location.origin) return Promise.reject(new Error("QA does not allow external requests"));
  if (url.pathname.startsWith("/api/")) url.searchParams.set("scenario", scenario);
  return nativeFetch(url, init);
};
function FixturePerformanceStatus(){
 const tasks=useRef<number[]>([]),[timing,setTiming]=useState('尚未量測'),[draft,setDraft]=useState('尚未檢查');
 useEffect(()=>{if(!PerformanceObserver.supportedEntryTypes.includes('longtask'))return;const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())tasks.current.push(entry.duration);});observer.observe({type:'longtask'});return()=>observer.disconnect();},[]);
 const [count,setCount]=useState<number|null>(null);
 return <details style={{position:'fixed',bottom:8,right:8,zIndex:100,background:'var(--card)',padding:8}}><summary>隔離快取驗證</summary><button onClick={async()=>setCount((await(await fetch('/api/qa/performance-count')).json()).requests)}>檢查歷史請求數</button><output aria-label="歷史請求数">{count??'尚未檢查'}</output>
 <button onClick={()=>{tasks.current=[];setTiming('量測中');}}>開始輸入效能量測</button><button onClick={()=>setTiming(`超過 50ms 工作：${tasks.current.length}；最長 ${Math.round(Math.max(0,...tasks.current))}ms`)}>查看輸入效能</button><output>{timing}</output>
 <button onClick={()=>{const request=indexedDB.open('tradergym-ledger-cache',1);request.onsuccess=()=>{const db=request.result;const read=db.transaction('records').objectStore('records').get(`fixture-user-${scenario}:qa-main`);read.onsuccess=()=>{setDraft(JSON.stringify(read.result?.record?.dataset?.simpleEntryDraft||null));db.close();};};}}>檢查本機草稿</button><output>{draft}</output></details>;
}
function FixtureImport() {
  return <button type="button" className="qa-import" style={{ position: "fixed", bottom: 8, left: 8, zIndex: 100, fontSize: 12 }} onClick={async (event) => {
    const button = event.currentTarget;
    const text = await (await nativeFetch("/fixture.json")).text();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) return;
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "isolated-ui-fixture.json", { type: "application/json" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    button.hidden = true;
  }}>載入隔離匯入檔</button>;
}
const user={id:`fixture-user-${scenario}`,email:"fixture@example.test",name:"測試帳號",picture:"",isOwner:true,sessionId:"fixture-session",expiresAt:"2099-01-01T00:00:00Z"};
createRoot(document.getElementById("root")!).render(scenario.startsWith("admin")?<AdminWorkspace user={user}/>:<><TradeWorkspace user={user} /><FixtureImport /><FixturePerformanceStatus/></>);
