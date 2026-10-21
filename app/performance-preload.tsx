"use client";
import {useEffect,useMemo} from 'react';
import {performanceRequests} from '@/lib/performance-history.mjs';
import {useWorkspaceClock} from './workspace-clock';
import {createPerformanceHistoryResource} from '@/lib/performance-cache.mjs';
import {performanceCacheFromSnapshot} from '@/lib/snapshot-performance.mjs';
export type PerformanceResource=ReturnType<typeof createPerformanceHistoryResource>;
export function PerformancePreload({data,resource,enabled,now}:{data:{fills:unknown[];cashActivities?:unknown[];marketBars?:unknown[];marketSnapshot?:unknown;settings?:unknown};resource:PerformanceResource;enabled:boolean;now?:string}){
 const current=useWorkspaceClock(),clock=now||current;
 const {fills,cashActivities,marketBars,marketSnapshot,settings}=data;
 // Draft edits must not seed, clone and republish the entire history cache.
 const snapshot=useMemo(()=>({fills,marketBars,marketSnapshot,settings}),[fills,marketBars,marketSnapshot,settings]);
 const targetKey=useMemo(()=>JSON.stringify(performanceRequests({fills,cashActivities},new Date(clock))),[fills,cashActivities,clock]);
 useEffect(()=>{if(enabled)resource.seed(performanceCacheFromSnapshot(snapshot));},[resource,enabled,snapshot]);
 useEffect(()=>{if(enabled)void resource.load(JSON.parse(targetKey));else resource.dispose();},[resource,targetKey,enabled]);
 useEffect(()=>()=>resource.dispose(),[resource]);
 return null;
}
