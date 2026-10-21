import {sessionDates,sessionState} from '../lib/rotation-calendar.mjs';
import {ROTATION_UNIVERSE,alignPeriods,rotationSeries} from '../lib/rotation-engine.mjs';
export const ROTATION_NOW=Date.parse('2026-10-21T17:00:00Z');
export function rotationFixture(symbol='SPY',now=ROTATION_NOW) {
 const index=ROTATION_UNIVERSE.findIndex(r=>r.symbol===symbol)+1;
 const dates=sessionDates('2023-10-21',sessionState(now).date);
 const close=dates.map((_,i)=>100*Math.exp(.0002*i+(index? .08*Math.sin(i/34+index*.6)+.03*Math.sin(i/13+index):0)));
 return {chart:{result:[{meta:{currency:'USD',exchangeTimezoneName:'America/New_York',regularMarketTime:Math.floor(now/1000)-2,regularMarketPrice:close.at(-1),currentTradingPeriod:{regular:{start:Math.floor(now/1000)-3600,end:Math.floor(now/1000)+10800}}},timestamp:dates.map(d=>Date.parse(d+'T14:30:00Z')/1000),indicators:{quote:[{close}],adjclose:[{adjclose:close}]}}],error:null}};
}
export function rotationSnapshot() {
 const bars=s=>{const r=rotationFixture(s).chart.result[0];return r.timestamp.map((t,i)=>({date:new Date(t*1000).toISOString().slice(0,10),close:r.indicators.adjclose[0].adjclose[i]}));};
 const base=bars('SPY'),state=sessionState(ROTATION_NOW);
 const rows=ROTATION_UNIVERSE.map(r=>{const build=interval=>rotationSeries(alignPeriods(bars(r.symbol),base,{start:'2023-10-21',end:state.date,completedThrough:state.lastCompleted,interval})).filter(p=>p.date>='2024-10-21');return {...r,daily:build('daily'),weekly:build('weekly'),preview:true,quoteTime:new Date(ROTATION_NOW-2000).toISOString()};});
 return {version:'tg-rotation-v1',benchmark:'SPY',source:'隔離驗收資料（合成行情，非真實市場）',marketOpen:true,fetchedAt:new Date(ROTATION_NOW).toISOString(),quoteTime:new Date(ROTATION_NOW-2000).toISOString(),rows,errors:[],warnings:[]};
}
