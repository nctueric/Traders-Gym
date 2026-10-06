"use client";
import {useEffect,useState} from 'react';
import TradeWorkspace from '../trade-workspace';
import {DemoContext} from '../demo-context';
import {createDemoRuntime} from '@/lib/demo-workspace.mjs';
export default function DemoPage(){const [runtime]=useState(()=>createDemoRuntime());useEffect(()=>{const leave=()=>runtime.reset();const restore=(event:PageTransitionEvent)=>{if(event.persisted)location.reload();};window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);return()=>{window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);runtime.reset();};},[runtime]);return <DemoContext.Provider value={runtime}><TradeWorkspace user={runtime.user} storageTarget="當次練習"/></DemoContext.Provider>;}
