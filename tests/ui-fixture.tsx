import {useState} from "react";
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
 const [count,setCount]=useState<number|null>(null);
 return <details style={{position:'fixed',bottom:8,right:8,zIndex:100,background:'var(--card)',padding:8}}><summary>隔離快取驗證</summary><button onClick={async()=>setCount((await(await fetch('/api/qa/performance-count')).json()).requests)}>檢查歷史請求數</button><output aria-label="歷史請求数">{count??'尚未檢查'}</output></details>;
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
