"use client";
import {useEffect,useMemo} from 'react';
import {performanceRequests} from '@/lib/performance-history.mjs';
import {useWorkspaceClock} from './workspace-clock';
import {createPerformanceHistoryResource} from '@/lib/performance-cache.mjs';
export type PerformanceResource=ReturnType<typeof createPerformanceHistoryResource>;
export function PerformancePreload({data,resource,enabled,now}:{data:{fills:unknown[];cashActivities?:unknown[]};resource:PerformanceResource;enabled:boolean;now?:string}){
 const current=useWorkspaceClock(),clock=now||current;
 const {fills,cashActivities}=data;
 const targetKey=useMemo(()=>JSON.stringify(performanceRequests({fills,cashActivities},new Date(clock))),[fills,cashActivities,clock]);
 useEffect(()=>{if(enabled)void resource.load(JSON.parse(targetKey));else resource.dispose();},[resource,targetKey,enabled]);
 useEffect(()=>()=>resource.dispose(),[resource]);
 return null;
}
