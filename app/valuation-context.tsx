/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import {createContext,useContext,useMemo} from 'react';
import {useWorkspacePreferences} from './workspace-preferences';
import {convertCurrency,formatCurrency,cycleValue} from '@/lib/valuation.mjs';
import {useSyncExternalStore} from 'react';
const Context=createContext<any>({currency:'USD',rate:null,fxBars:[],daily:null,formatUsd:(v:any)=>formatCurrency(v,'USD'),formatNative:(v:any,from:string)=>formatCurrency(convertCurrency(v,from,'USD',null),'USD'),format:(v:any)=>formatCurrency(v,'USD')});
export function useValuation(){return useContext(Context);}
export function ValuationProvider({rate,resource,children}:{rate:number|null;resource:any;children:React.ReactNode}){
 const {preferences}=useWorkspacePreferences();const currency=preferences.valuationCurrency;
 const {history}=useSyncExternalStore(resource.subscribe,resource.getSnapshot,resource.getSnapshot) as any;
 const fxBars=useMemo(()=>history?.cache?.entries?.['USDTWD=X:raw']?.bars||[],[history]);
 const value=useMemo(()=>({currency,rate,fxBars,history,format:(v:any)=>formatCurrency(v,currency),formatNative:(v:any,from:string)=>formatCurrency(convertCurrency(v,from,currency,rate),currency),formatUsd:(v:any)=>formatCurrency(convertCurrency(v,'USD',currency,rate),currency),cycleAmount:(c:any,v:any)=>cycleValue(c,v,currency,fxBars)}),[currency,rate,history,fxBars]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function ValuationControl(){const {preferences,ready,status,update,retry}=useWorkspacePreferences();return <div className="valuation-control"><label><span className="valuation-label">計價幣別</span> <select aria-label="計價幣別" disabled={!ready} value={preferences.valuationCurrency} onChange={e=>{void update({valuationCurrency:e.target.value}).catch(()=>{});}}><option value="USD">美元 USD</option><option value="TWD">台幣 TWD</option></select></label>{status&&<small role="status">{status}</small>}{!ready&&status&&<button type="button" onClick={retry}>重試載入偏好</button>}</div>;}
