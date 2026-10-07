/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {DEFAULT_PREFERENCES} from '@/lib/member-preferences.mjs';
import {createRecordSaveQueue} from '@/lib/trade-record-client.mjs';
const Context=createContext<any>({preferences:DEFAULT_PREFERENCES,ready:true,status:'',update:async()=>{}});
export const useWorkspacePreferences=()=>useContext(Context);
export function WorkspacePreferences({userId,demo,fetcher,children}:{userId:string;demo:any;fetcher:typeof fetch;children:React.ReactNode}){
 const [preferences,setPreferences]=useState({...DEFAULT_PREFERENCES,...demo?.preferences}),[ready,setReady]=useState(Boolean(demo)),[status,setStatus]=useState('');
 const [reload,setReload]=useState(0);
 const queue=useRef(createRecordSaveQueue());const current=useRef(preferences);useEffect(()=>{current.current=preferences;},[preferences]);
 useEffect(()=>{
  if(demo)return;let active=true;const controller=new AbortController();
  const load=async()=>{try{
   const response=await fetcher('/api/preferences',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10_000)]),cache:'no-store'});const body=await response.json();if(!response.ok)throw Error(body.error||'偏好載入失敗');
   if(!active)return;
   // Only an explicitly user-scoped legacy preference is eligible for one-time import.
   const patch:any={};try{const old=localStorage.getItem(`tg.entry-mode.${userId}`);if(!body.configured.includes('entryMode')&&['simple','full'].includes(old||''))patch.entryMode=old;
   if(!body.configured.includes('onboardingDone')&&localStorage.getItem(`traders-gym.v2.onboarding-complete.${userId}`)==='done')patch.onboardingDone=true;}catch{/* Optional legacy read only. */}
   if(!body.configured.includes('holdingsColorScheme')){const records=await fetcher('/api/trade-records',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10_000)]),cache:'no-store'});if(records.ok){const color=(await records.json()).dataset?.settings?.holdingsColorScheme;if(['green-up','red-up'].includes(color))patch.holdingsColorScheme=color;}}
   let next=body.preferences;if(Object.keys(patch).length){const saved=await fetcher('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10_000)])});if(!saved.ok)throw Error('舊偏好轉移失敗');next=(await saved.json()).preferences;}
   if(active){current.current=next;setPreferences(next);setReady(true);setStatus('');}
  }catch(e){if(active){setStatus(e instanceof Error?e.message:'偏好載入失敗');}}};void queue.current(load);
  const refresh=()=>{if(document.visibilityState==='visible')void queue.current(load);};window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);
  return()=>{active=false;controller.abort();window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);};
 },[userId,demo,fetcher,reload]);
 const update=(patch:any)=>queue.current(async()=>{
  if(demo){const next={...current.current,...patch};demo.preferences=next;current.current=next;setPreferences(next);return;}
  if(!ready)throw Error('偏好尚未就緒');if(!navigator.onLine){setStatus('目前離線，偏好尚未儲存');throw Error('目前離線，偏好尚未儲存');}
  setStatus('正在儲存偏好…');
  try{const response=await fetcher('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch),signal:AbortSignal.timeout(10_000)});const body=await response.json();if(!response.ok)throw Error(body.error||'偏好未儲存');current.current=body.preferences;setPreferences(body.preferences);setStatus('');}
  catch(e){setStatus(e instanceof Error?e.message:'偏好未儲存');throw e;}
 });
 return <Context.Provider value={{preferences,ready,status,update,retry:()=>setReload(v=>v+1)}}>{children}</Context.Provider>;
}
