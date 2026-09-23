/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTION_LABELS, ENTRY_OPTIONS, VOLUME_OPTIONS, ADD_OPTIONS, CHECK_OPTIONS, previewEntry, entryValuation, marketCurrency, contextsForCycle } from '@/lib/trade-entry.mjs';
import {EntryMarketChart,useEntryMarket} from './entry-market-chart';
import {InfoPopover,InfoPopoverGroup} from './info-popover';
import {historicalEntryStandard,resolveEntryPlan} from '@/lib/entry-standard-plan.mjs';
import { activeStrategyVersion, findStrategyVersion } from '@/lib/strategy-engine.mjs';
import { toProviderSymbol } from '@/lib/quote-engine.mjs';

const number = (value: any, digits = 2) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US',{maximumFractionDigits:digits});
const usd = (value: any) => value == null ? '無法計算' : `USD ${number(value)}`;
const percent = (value: any) => value == null ? '資料不足' : `${value>0?'+':''}${(value*100).toFixed(1)}%`;
const optionLabel = (options: string[][], value: string) => options.find(([key])=>key===value)?.[1] || '未記錄';

export function EntryCandles({evidence,price,stop,target}: {evidence:any;price?:any;stop?:any;target?:any}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [selected,setSelected] = useState<number | null>(null);
  const bars = useMemo(() => evidence.candles || [], [evidence.candles]);
  const index = Math.min(Math.max(0,selected ?? bars.length-1),Math.max(0,bars.length-1));
  const bar = bars[index];
  useEffect(()=>{
    const element=canvas.current;
    if (!element || !bars.length) return;
    const draw=()=>{
      const width=Math.max(280,element.getBoundingClientRect().width),height=320,dpr=window.devicePixelRatio || 1;
      element.width=width*dpr;element.height=height*dpr;
      const ctx=element.getContext('2d');if(!ctx)return;
      ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
      const left=10,right=85,top=24,plotHeight=170,bottom=265;
      const values=bars.flatMap((item:any)=>[Number(item.high),Number(item.low)]);
      [price,stop,target].forEach((value)=>{if(Number(value)>0)values.push(Number(value));});
      const min=Math.min(...values),max=Math.max(...values),span=Math.max(max-min,max*.02),low=min-span*.08,high=max+span*.08;
      const y=(value:number)=>top+(high-value)/(high-low)*plotHeight;
      const step=(width-left-right)/bars.length;
      ctx.font='11px system-ui';ctx.fillStyle='#56645e';
      for(let tick=0;tick<=3;tick++){const value=low+(high-low)*tick/3;ctx.fillText(number(value),width-right+8,y(value)+4);ctx.strokeStyle='#e0e7e2';ctx.beginPath();ctx.moveTo(left,y(value));ctx.lineTo(width-right,y(value));ctx.stroke();}
      const volumes=bars.map((item:any)=>Number(item.volume)||0),maxVolume=Math.max(...volumes,1);
      bars.forEach((item:any,i:number)=>{
        const x=left+step*(i+.5),color=item.close>=item.open?'#168362':'#cb4848',w=Math.max(3,step*.56);
        if(i===index){ctx.fillStyle='rgba(23,107,80,.07)';ctx.fillRect(x-step/2,top,step,bottom-top);}
        ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,y(item.high));ctx.lineTo(x,y(item.low));ctx.stroke();ctx.fillRect(x-w/2,Math.min(y(item.open),y(item.close)),w,Math.max(1,Math.abs(y(item.close)-y(item.open))));
        if(item.volume!=null)ctx.fillRect(x-w/2,bottom-48*item.volume/maxVolume,w,48*item.volume/maxVolume);
        ctx.fillStyle='#56645e';ctx.textAlign='center';if(step>=34 || i%2===0)ctx.fillText(item.date.slice(5),x,283);
      });
      ctx.textAlign='left';
      for(const [raw,label,color] of [[price,'成交價','#3864b0'],[stop,'停損','#cb4848'],[target,'停利','#168362']]){
        if(!(Number(raw)>0))continue;ctx.strokeStyle=String(color);ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(left,y(Number(raw)));ctx.lineTo(width-right,y(Number(raw)));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=String(color);ctx.fillText(String(label),width-right+8,y(Number(raw))-7);
      }
      if(evidence.averageVolume10!=null){const vy=bottom-48*evidence.averageVolume10/maxVolume;ctx.setLineDash([2,3]);ctx.strokeStyle='#69766e';ctx.beginPath();ctx.moveTo(left,vy);ctx.lineTo(width-right,vy);ctx.stroke();ctx.setLineDash([]);ctx.fillText('10日均量',width-right+8,vy);}
      if(Number(price)>0){const x=width-right,py=y(Number(price));ctx.fillStyle='#3864b0';ctx.beginPath();ctx.moveTo(x,py);ctx.lineTo(x+7,py-4);ctx.lineTo(x+7,py+4);ctx.closePath();ctx.fill();}
      ctx.fillStyle='#56645e';ctx.fillText('右側標記＝成交日價格；不代表前十日成交',left,309,width-20);
    };
    draw();const observer=new ResizeObserver(draw);observer.observe(element);return()=>observer.disconnect();
  },[bars,index,price,stop,target,evidence.averageVolume10]);
  return <div className="entry-candles">{bars.length ? <><canvas ref={canvas} role="img" aria-label={`成交日前 ${bars.length} 根日K與成交量，日線近似`} onPointerMove={(event)=>{const rect=event.currentTarget.getBoundingClientRect();setSelected(Math.min(bars.length-1,Math.max(0,Math.floor((event.clientX-rect.left-10)/(rect.width-95)*bars.length))));}}/><label>逐日查看<input aria-label="查看日K日期" type="range" min={0} max={bars.length-1} value={index} onChange={(event)=>setSelected(Number(event.target.value))}/></label><p className="entry-ohlc"><b>{bar.date}</b><span>開 {number(bar.open)}</span><span>高 {number(bar.high)}</span><span>低 {number(bar.low)}</span><span>收 {number(bar.close)}</span><span>量 {number(bar.volume,0)}</span></p></> : <div className="mini-empty">沒有有效的成交前日線，仍可保存真實成交。</div>}<p className="section-note">成交前完整日線 {bars.length}/10・10日均量 {number(evidence.averageVolume10,0)}・量比 {number(evidence.volumeRatio)}<br/>量比＝最新完整日成交量 ÷ 前10個完整日均量。未取得11根或成交量缺漏時不計算。</p>{evidence.fillDayBar && <details><summary>成交日 K 線（事後資訊）</summary><p>{evidence.fillDayBar.date} 開 {number(evidence.fillDayBar.open)}／高 {number(evidence.fillDayBar.high)}／低 {number(evidence.fillDayBar.low)}／收 {number(evidence.fillDayBar.close)}／量 {number(evidence.fillDayBar.volume,0)}</p><small>日線可能尚未收盤；無法據此推測成交當下已知的高低價或事件順序。</small></details>}</div>;
}

export function EntryContextEvidence({contexts={},cycleId}: {contexts?:Record<string,any>;cycleId:string}) {
  const rows=contextsForCycle(contexts,cycleId);
  return <section className="entry-context-evidence"><h3>成交登錄證據</h3>{!rows.length ? <p className="muted">舊交易沒有勾選登錄證據；不從價格或備註推測。</p> : rows.map((row:any)=><details key={row.fillId}><summary>{ACTION_LABELS[row.action as keyof typeof ACTION_LABELS]}・{new Date(row.fillTimestamp).toLocaleString('zh-TW')}・{row.formatVersion===2?'策略進場':optionLabel(ENTRY_OPTIONS,row.entrySetup)} {row.pending?.length ? `／待補 ${row.pending.length} 項` : ''}</summary><p>事後登錄／確認：{new Date(row.recordedAt).toLocaleString('zh-TW')}<br/>策略版本：{row.strategyVersionId || '未指定'}・計畫引用：{Object.values(row.planReferences || {}).join('、') || '未設定／歷史值，時間不明'}</p><p>理由：{row.note || '待補'}{row.formatVersion!==2 && row.action==='ADD' && `・加碼理由：${optionLabel(ADD_OPTIONS,row.addReason)}`}</p><p>{row.formatVersion!==2&&<>量價：{row.volumeTags?.map((tag:string)=>optionLabel(VOLUME_OPTIONS,tag)).join('、') || '未記錄'}<br/></>}原部位以成交價估算浮動盈虧：{number(row.originalUnrealizedAtFill?.amount)} {row.originalUnrealizedAtFill?.currency}</p><p>停損 {number(row.planSnapshot?.stopLoss)}／停利 {number(row.planSnapshot?.takeProfit)}・資產情境 {percent(row.valuation?.stop?.assetChangePct)}／{percent(row.valuation?.target?.assetChangePct)}<br/>估值快照 {row.valuation?.asOf}・{row.valuation?.reasons?.join('；')}</p>{row.standardSnapshot&&<p>歷史標準：獲利 {row.standardSnapshot.winnerCount} 筆／{percent(row.standardSnapshot.averageWinRate)}，虧損 {row.standardSnapshot.loserCount} 筆／{percent(row.standardSnapshot.averageLossRate)} × 0.5；均價 {number(row.standardSnapshot.averageCost,4)}。<br/>樣本截止 {row.standardSnapshot.cutoff}；停利來源 {row.standardSnapshot.sources?.takeProfit}／停損來源 {row.standardSnapshot.sources?.stopLoss}。</p>}<ul>{Object.entries(row.ruleChecks || {}).map(([id,check]:any)=><li key={id}>{check.name || id}：{optionLabel(CHECK_OPTIONS,check.status)}（{check.checkedAt || '待確認'}）{check.criterion && <small>・{check.criterion}</small>}</li>)}</ul><EntryCandles evidence={row.evidence} price={row.fillPrice} stop={row.planSnapshot?.stopLoss} target={row.planSnapshot?.takeProfit}/></details>)}</section>;
}

export function TradeEntryWorkspace({data,draft,quotes,onChange,onSubmit,onBack}: {data:any;draft:any;quotes:Record<string,any>;onChange:(patch:any)=>void;onSubmit:(entry?:any)=>void;onBack:()=>void}) {
 const market=useEntryMarket(draft,data,quotes);
 const rawPreview=useMemo(()=>previewEntry(data,draft),[data,draft]);
 const standard=useMemo(()=>historicalEntryStandard(data,draft.timestamp),[data,draft.timestamp]);
 const effective=useMemo(()=>resolveEntryPlan({...draft,formatVersion:2},rawPreview,standard),[draft,rawPreview,standard]);
 const preview=useMemo(()=>previewEntry(data,effective),[data,effective]);
 const snapshot={quotes:market.quotes,capturedAt:new Date().toISOString()};
 const valuation=entryValuation(data,preview,effective,snapshot);
 const [error,setError]=useState(''),[submitting,setSubmitting]=useState(false);const guard=useRef(false);
 const change=(patch:any)=>{setError('');onChange({...patch,formatVersion:2,updatedAt:new Date().toISOString()});};
 const basic=(patch:any)=>change({...patch,confirmedKey:''});
 const reset=(patch:any)=>basic({...patch,stopLoss:undefined,takeProfit:undefined,planModes:{},stopBasis:'UNSET',targetBasis:'UNSET',strategyId:'',strategyVersionId:'',ruleChecks:{}});
 const inherited=preview.assignment;
 const strategy=inherited?findStrategyVersion(data.strategies,inherited.strategyId,inherited.strategyVersionId).strategy:(data.strategies||[]).find((s:any)=>s.id===draft.strategyId);
 const version=inherited?findStrategyVersion(data.strategies,inherited.strategyId,inherited.strategyVersionId).version:strategy?.versions?.find((v:any)=>v.id===draft.strategyVersionId);
 const applicable=['ENTRY','ADD','REVERSAL'].includes(preview.action||'');
 const rules=(version?.rules||[]).filter((r:any)=>r.group!=='EXIT_TRIGGER');
 const confirmed=!!preview.confirmationKey&&draft.confirmedKey===preview.confirmationKey;
 const quote=market.quotes?.[toProviderSymbol(market.symbol,draft.market)];
 const unit=marketCurrency(draft.market);
 const fieldError=(label:string)=>{const key=({標的:'symbol',股數:'quantity',成交價:'price'} as Record<string,string>)[label];return key&&draft[key]===''?undefined:preview.errors.find((message:string)=>message.includes(label));};
 const ruleRow=(rule:any)=><div className="entry-rule-row" key={rule.id}><div><b>{rule.name}</b><InfoPopover label={rule.name}><p>{rule.criterion}</p><p>{rule.checkpoint} {rule.note}</p><p>成交後登錄／確認，並非事前檢查。</p></InfoPopover></div><select aria-label={`${rule.name}確認`} value={draft.ruleChecks?.[rule.id]||'UNREVIEWED'} onChange={e=>change({ruleChecks:{...draft.ruleChecks,[rule.id]:e.target.value}})}>{CHECK_OPTIONS.map(([key,label]:string[])=><option key={key} value={key}>{label}</option>)}</select></div>;
 const submit=()=>{
  if(guard.current)return;guard.current=true;setSubmitting(true);
  try {onSubmit({...effective,quoteSnapshot:snapshot,evidenceKey:market.identity,evidenceBars:market.bars,evidenceFetchedAt:market.fetchedAt,evidenceSource:market.source});}
  catch(cause){setError(cause instanceof Error?cause.message:'登錄失敗，請重試');guard.current=false;setSubmitting(false);}
 };
 return <InfoPopoverGroup><section className="trade-entry-workspace entry-v2"><form noValidate onSubmit={e=>{e.preventDefault();submit();}}>
 <div className="entry-ticket-head"><div><h2>成交與計畫登錄</h2><small>已成交後登錄・草稿自動保留</small></div><button type="button" className="ghost" onClick={onBack}>返回總覽</button></div>
 <div className="entry-context-bar"><label>標的<input autoComplete="off" aria-invalid={!!fieldError('標的')} value={draft.symbol} onChange={e=>reset({symbol:e.target.value.toUpperCase()})} placeholder="例：NVTS"/>{fieldError('標的')&&<small className="entry-warning">{fieldError('標的')}</small>}</label><label>市場<select value={draft.market} onChange={e=>reset({market:e.target.value})}>{['NASDAQ','NYSE','AMEX','TWSE','TPEX'].map(m=><option key={m}>{m}</option>)}</select></label><label>交易帳戶<select value={draft.accountId} onChange={e=>{const a=data.accounts.find((a:any)=>a.id===e.target.value);reset({accountId:a.id,market:a.currency==='TWD'?'TWSE':'NASDAQ'});}}>{data.accounts.map((a:any)=><option key={a.id} value={a.id}>{a.name}・{a.currency}</option>)}</select>{fieldError('帳戶')&&<small className="entry-warning">{fieldError('帳戶')}</small>}</label><div className="entry-live-quote"><span>最新價格</span><b>{quote?`${quote.currency} ${number(quote.price,4)}`:'—'}</b><small>{quote?.updatedAt?new Date(quote.updatedAt).toLocaleString('zh-TW'):'等待行情'}・可能延遲</small></div></div>
 <div className="entry-ticket-grid"><EntryMarketChart key={`${draft.accountId}:${draft.market}:${market.symbol}`} market={market} draft={effective} preview={preview} data={data}/><div className="entry-ticket-form">
 <section><div className="entry-section-title"><h3>成交資料</h3><InfoPopover label="成交資料"><p>只登錄已發生的成交；成交價不會隨行情自動改寫。買賣方向與 FIFO 庫存決定新倉、加碼、減碼、平倉或反手。</p></InfoPopover></div><div className="entry-fields"><label>買賣方向<select value={draft.side} onChange={e=>reset({side:e.target.value})}><option value="BUY">買進／回補</option><option value="SELL">賣出／放空</option></select></label>{[['quantity','股數'],['price',`成交價（${unit}）`],['fee',`手續費（${unit}）`]].map(([key,label])=><label key={key}>{label}<input type="number" step="any" min="0" value={draft[key]} aria-invalid={!!fieldError(key==='quantity'?'股數':key==='price'?'成交價':'手續費')} onChange={e=>basic({[key]:e.target.value})}/>{fieldError(key==='quantity'?'股數':key==='price'?'成交價':'手續費')&&<small className="entry-warning">{fieldError(key==='quantity'?'股數':key==='price'?'成交價':'手續費')}</small>}</label>)}<label className="entry-wide">成交時間（裝置當地時間）<input type="datetime-local" value={draft.timestamp} onChange={e=>basic({timestamp:e.target.value})}/>{fieldError('成交時間')&&<small className="entry-warning">{fieldError('成交時間')}</small>}</label></div></section>
 <section><div className="entry-section-title"><h3>策略進場</h3><InfoPopover label="策略進場"><p>沿用策略版本與市場／進場規則。加碼的本次確認獨立保存，不覆寫最初開倉判斷；未指定策略可先登錄。</p></InfoPopover></div>{inherited?<div className="entry-inherited">{strategy?.name||inherited.strategyId}・v{version?.version||'—'} <small>沿用原策略</small></div>:applicable?<label className="entry-strategy-select"><span className="sr-only">主策略</span><select aria-label="主策略" value={draft.strategyId} onChange={e=>{const selected=(data.strategies||[]).find((s:any)=>s.id===e.target.value);change({strategyId:e.target.value,strategyVersionId:activeStrategyVersion(selected)?.id||'',ruleChecks:{}});}}><option value="">未指定策略（可待補）</option>{(data.strategies||[]).filter((s:any)=>s.status==='ACTIVE'&&activeStrategyVersion(s)).map((s:any)=><option key={s.id} value={s.id}>{s.name}・v{activeStrategyVersion(s).version}</option>)}</select></label>:<small>{preview.action?'減碼／平倉沿用既有策略，毋須重填。':'填妥成交後選擇策略。'}</small>}{applicable&&<>{rules.slice(0,2).map(ruleRow)}{rules.length>2&&<details className="entry-more-rules"><summary>其餘 {rules.length-2} 項策略條件</summary>{rules.slice(2).map(ruleRow)}</details>}</>}</section>
 <section><div className="entry-section-title"><h3>整筆持倉計畫</h3><InfoPopover label="歷史標準"><p>截至 {standard.cutoff?new Date(standard.cutoff).toLocaleString('zh-TW'):'—'} 前，全部帳戶與策略已平倉交易。</p><p>獲利 {standard.winnerCount} 筆，平均 {percent(standard.averageWinRate)}；虧損 {standard.loserCount} 筆，平均 {percent(standard.averageLossRate)}。</p><p>停利採平均獲利率；停損採平均虧損幅度 × 0.5。以操作後 FIFO 均價 {number(preview.after?.averageCost,4)} {unit} 換算，多空方向相反。</p><p>價格情境未含未來出場費用、滑價。缺樣本或計算出非正價格不自動套用，可手動填寫。</p></InfoPopover>{preview.after&&<button type="button" className="entry-standard-button" onClick={()=>change({stopLoss:undefined,takeProfit:undefined,planModes:{stopLoss:'STANDARD',takeProfit:'STANDARD'}})}>套用標準</button>}</div>{preview.after?<div className="entry-plan-lines">{[['takeProfit','停利'],['stopLoss','停損']].map(([field,label])=>{const raw=effective[field],rate=Number(raw)>0?(preview.after!.direction==='SHORT'?-1:1)*(Number(raw)/preview.after!.averageCost-1):null;const source=effective.standardSnapshot.sources[field];return <label className="entry-plan-line" key={field}><span>{label}<small>{unit}</small></span><input aria-label={`${label}價`} type="number" min="0" step="any" value={raw} onChange={e=>change({[field]:e.target.value,planModes:{...draft.planModes,[field]:'MANUAL'}})}/><b className={rate!=null&&rate<0?'negative':'positive'}>{percent(rate)}</b><small>{source==='STANDARD'?(raw===''?'資料不足・請手動設定':'歷史標準'):source==='ORIGINAL'?'原計畫':'手動設定'}</small></label>;})}</div>:<small>{preview.action==='EXIT'?'平倉後無剩餘部位，不新增停利停損。':'填妥成交後顯示標準計畫。'}</small>}{['停利價','停損價'].map(label=>fieldError(label)&&<small className="entry-warning" key={label}>{fieldError(label)}</small>)}{preview.after&&Number(effective.stopLoss)>0&&valuation.mark&&(preview.after.direction==='SHORT'?Number(effective.stopLoss)<=valuation.mark:Number(effective.stopLoss)>=valuation.mark)&&<small className="entry-warning">停損已越過參考現價，請檢查計畫。</small>}</section>
 <label className="entry-note">備註<input value={draft.note} onChange={e=>change({note:e.target.value})} placeholder="選填：本次成交的補充說明"/></label>
 </div></div>
 <footer className="entry-confirmation-bar"><div className="entry-impact-strip"><div><span>操作／股數</span><b>{ACTION_LABELS[preview.action as keyof typeof ACTION_LABELS]||'待填成交'}・{number(preview.before?.quantity||0,4)} → {number(preview.after?.quantity||0,4)}</b></div><div><span>持倉占比</span><b>{percent(valuation.positionPct)}</b></div><div><span>停損資產影響</span><b className="negative">{percent(valuation.stop?.assetChangePct)}</b></div><InfoPopover label="操作與資產影響"><p>方向：{preview.before?.direction||'無'} → {preview.after?.direction||'無'}；FIFO 均價 {number(preview.before?.averageCost,4)} → {number(preview.after?.averageCost,4)} {unit}。</p><p>登錄後淨值 {usd(valuation.navUsd)}；新增占比 {percent(valuation.addedPct)}。</p><p>停利情境 {percent(valuation.target?.assetChangePct)}／{usd(valuation.target?.assetChangeUsd)}；停損情境 {percent(valuation.stop?.assetChangePct)}／{usd(valuation.stop?.assetChangeUsd)}。</p><p>相對成本預估損益：停利 {usd(valuation.target?.costPnlUsd)}／停損 {usd(valuation.stop?.costPnlUsd)}。以上為整筆剩餘持倉的情境，非已實現損益。</p><p>參考現價 {number(valuation.mark,4)}；USD/TWD {number(valuation.fxRate,4)}。</p>{valuation.reasons.map((r:string)=><p key={r}>{r}</p>)}</InfoPopover></div><div className="entry-submit-controls"><label className="entry-confirm"><input type="checkbox" checked={confirmed} disabled={!preview.confirmationKey} onChange={e=>change({confirmedKey:e.target.checked?preview.confirmationKey:''})}/>確認操作與股數</label><button className="primary" type="submit" disabled={submitting||!!preview.errors.length||!!preview.affected.length||!confirmed}>{submitting?'登錄中…':'登錄成交與計畫'}</button></div>{preview.sameTime&&<small className="entry-warning">同時間已有成交，本筆排於既有成交之後。</small>}{preview.affected.length>0&&<p role="alert" className="entry-warning">歷史補登會重組已註記閉環，暫停提交：{preview.affected.map((c:any)=>c.symbol+' '+c.openAt).join('、')}</p>}{error&&<p role="alert" className="entry-warning">{error}</p>}<small className="entry-submit-note">提交一次保存成交、策略與計畫；不會送出券商訂單。</small></footer>
 </form></section></InfoPopoverGroup>;
}
