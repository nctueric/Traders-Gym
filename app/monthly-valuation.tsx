/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import {useValuation} from './valuation-context';
import {historicalMonths} from '@/lib/valuation-reports.mjs';
export function MonthlyValuation({data,asOf,currentTotal,cycles}:{data:any;asOf:string;currentTotal:number|null;cycles:any[]}){
 const {currency,history,format}=useValuation();const rows=historicalMonths(data,history?.cache,new Date(asOf),currency,{total:currentTotal,cycles}),max=Math.max(1,...rows.map(r=>r.total||0));
 return <section className="monthly-assets"><h3>逐月資產變化・{currency}</h3><p>歷史月末按各日有效匯率估值，本月採目前行情。報酬包含匯率變動，缺資料不補造。</p><div className="table-wrap" tabIndex={0} role="region" aria-label="逐月資產數據"><table><thead><tr><th>月份</th><th>總資產 {currency}</th><th>較上月</th><th>已實現（累計）</th><th>本月入金</th><th>本月出金</th><th>估值狀態</th></tr></thead><tbody>{rows.map(r=><tr key={r.month}><td>{r.month}{r.isCurrent?' 至今':''}</td><td><span style={{display:'inline-block',width:`${Math.max(0,(r.total||0)/max)*60}px`,height:'4px',background:'var(--green)',marginRight:'8px'}}/>{format(r.total)}</td><td>{format(r.change)}</td><td>{format(r.realized)}</td><td>{format(r.deposit)}</td><td>{format(r.withdrawal)}</td><td>{r.problems.join('；')||'有效資料'}</td></tr>)}</tbody></table></div></section>;
}
