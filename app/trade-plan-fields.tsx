/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import {type ReactNode} from 'react';
import {InfoPopover} from './info-popover';
export const planPercent=(value:any)=>value==null?'—':`${value>0?'+':''}${(value*100).toFixed(1)}%`;
export function TradeSection({title,help,actions,children}:{title:string;help?:ReactNode;actions?:ReactNode;children:ReactNode}) {
 return <section><div className="entry-section-title"><h3>{title}</h3>{help&&<InfoPopover label={title}>{help}</InfoPopover>}{actions}</div>{children}</section>;
}
export function TradeFillFields({value,currency,onChange,onSideChange,errors=()=>undefined}:{value:any;currency:string;onChange?:(patch:any)=>void;onSideChange?:(side:string)=>void;errors?:(label:string)=>string|undefined}) {
 const readonly=!onChange;
 return <div className="entry-fields"><label>買賣方向{readonly?<b>{value.side==='BUY'?'買進／回補':value.side==='SELL'?'賣出／放空':'未記錄'}</b>:<select value={value.side} onChange={e=>onSideChange?.(e.target.value)}><option value="BUY">買進／回補</option><option value="SELL">賣出／放空</option></select>}</label>{[['quantity','股數'],['price',`成交價（${currency}）`],['fee',`手續費（${currency}）`]].map(([key,label])=><label key={key}>{label}{readonly?<b>{value[key]==null?'未記錄':Number(value[key]).toLocaleString('en-US',{maximumFractionDigits:6})}</b>:<input type="number" min="0" step="any" value={value[key]} aria-invalid={!!errors(key==='quantity'?'股數':key==='price'?'成交價':'手續費')} onChange={e=>onChange({[key]:e.target.value})}/>}</label>)}<label className="entry-wide">成交時間（裝置當地時間）{readonly?<b>{value.timestamp?new Date(value.timestamp).toLocaleString('zh-TW'):'未記錄'}</b>:<input type="datetime-local" value={value.timestamp} onChange={e=>onChange({timestamp:e.target.value})}/>}</label>{['股數','成交價','手續費','成交時間'].map(label=>errors(label)&&<small key={label} className="entry-warning">{errors(label)}</small>)}</div>;
}
export function PlanPriceFields({value,position,currency,sources={},onChange}:{value:any;position:any;currency:string;sources?:any;onChange?:(field:string,value:string)=>void}) {
 return <div className="entry-plan-lines">{[['takeProfit','停利'],['stopLoss','停損']].map(([field,label])=>{const raw=value[field],rate=Number(raw)>0&&position?.averageCost>0?(position.direction==='SHORT'?-1:1)*(Number(raw)/position.averageCost-1):null;return <label className="entry-plan-line" key={field}><span>{label}<small>{currency}</small></span>{onChange?<input aria-label={`${label}價`} type="number" min="0" step="any" value={raw??''} onChange={e=>onChange(field,e.target.value)}/>:<b>{raw==null||raw===''?'未設定':Number(raw).toLocaleString('en-US',{maximumFractionDigits:6})}</b>}<b className={rate==null?'muted':rate<0?'negative':'positive'}>{planPercent(rate)}</b><small>{sources[field]==='STANDARD'?(raw==null||raw===''?'資料不足・請手動設定':'歷史標準'):sources[field]==='MANUAL'?'手動設定':sources[field]==='ORIGINAL'?'原計畫':'已保存'}</small></label>;})}</div>;
}
export function StandardPlanHelp({standard,averageCost,currency}:{standard:any;averageCost:any;currency:string}) {
 return <><p>全部帳戶與策略已平倉交易；截止 {standard?.cutoff?new Date(standard.cutoff).toLocaleString('zh-TW'):'未記錄'}。</p><p>獲利 {standard?.winnerCount??'—'} 筆，平均 {planPercent(standard?.averageWinRate)}；虧損 {standard?.loserCount??'—'} 筆，平均 {planPercent(standard?.averageLossRate)}。</p><p>停利採平均獲利率；停損採平均虧損幅度 × 0.5。以 FIFO 均價 {averageCost??'—'} {currency} 換算，多空方向相反。</p><p>未含未來費用及滑價。缺樣本或非正價格保留空白。</p></>;
}
