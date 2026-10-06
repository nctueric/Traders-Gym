"use client";
import {useEffect,useMemo,useState} from 'react';
import {performanceRequests} from '@/lib/performance-history.mjs';
import {createPerformanceHistoryResource} from '@/lib/performance-cache.mjs';
export type PerformanceResource=ReturnType<typeof createPerformanceHistoryResource>;
export function PerformancePreload({data,resource,enabled,now}:{data:{fills:unknown[];cashActivities?:unknown[]};resource:PerformanceResource;enabled:boolean;now?:string}){
 const [clock,setClock]=useState(()=>now||new Date().toISOString());
 useEffect(()=>{if(now)return;const timer=setInterval(()=>setClock(new Date().toISOString()),3600000);return()=>clearInterval(timer);},[now]);
 const {fills,cashActivities}=data;
 const targetKey=useMemo(()=>JSON.stringify(performanceRequests({fills,cashActivities},new Date(clock))),[fills,cashActivities,clock]);
 useEffect(()=>{if(enabled)void resource.load(JSON.parse(targetKey));else resource.dispose();},[resource,targetKey,enabled,clock]);
 useEffect(()=>()=>resource.dispose(),[resource]);
 return null;
}
