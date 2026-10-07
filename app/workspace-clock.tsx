"use client";
import {useEffect,useState} from 'react';
import {useDemoRuntime} from './demo-context';
const systemTime=()=>new Date().toISOString();
// Minute-level UI clock; mutations read runtime.now() afresh at the action boundary.
export function useWorkspaceClock(){
 const demo=useDemoRuntime(),read=demo?.now||systemTime;
 const [now,setNow]=useState(read);
 useEffect(()=>{const update=()=>setNow(read());const timer=setInterval(update,30000);document.addEventListener('visibilitychange',update);window.addEventListener('pageshow',update);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);window.removeEventListener('pageshow',update);};},[read]);
 return now;
}
