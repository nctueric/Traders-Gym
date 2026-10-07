"use client";
import {useEffect,useState} from 'react';
import TradeWorkspace from '../trade-workspace';
import {Brand} from '../brand';
import {DemoContext} from '../demo-context';
import {createDemoRuntime} from '@/lib/demo-workspace.mjs';
export default function DemoPage(){
 const [runtime]=useState(()=>createDemoRuntime()),[status,setStatus]=useState('正在載入真實市場資料…'),[error,setError]=useState(''),[ready,setReady]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  void runtime.initialize({signal:controller.signal,onProgress:(done:number,total:number)=>setStatus(`正在載入真實市場資料 ${done}／${total}…`)}).then(()=>{if(!controller.signal.aborted)setReady(true);}).catch((e:Error)=>{if(!controller.signal.aborted)setError(e.message);});
  const leave=()=>runtime.reset(),restore=(event:PageTransitionEvent)=>{if(event.persisted)location.reload();};
  window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);
  return()=>{controller.abort();window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);runtime.reset();};
 },[runtime,attempt]);
 if(!ready)return <main className="auth-page"><section className="auth-panel"><Brand/><h1>訪客練習</h1><p>真實市場資料・示範交易</p>{error?<><p role="alert">{error}</p><button className="primary" onClick={()=>{setError('');setStatus('正在重新載入真實市場資料…');setAttempt(v=>v+1);}}>重試載入</button></>:<p role="status">{status}</p>}<a href="/login">返回登入</a></section></main>;
 return <DemoContext.Provider value={runtime}><TradeWorkspace user={runtime.user}/></DemoContext.Provider>;
}
