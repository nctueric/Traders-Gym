/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import {useValuation} from './valuation-context';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTION_LABELS, ENTRY_OPTIONS, VOLUME_OPTIONS, ADD_OPTIONS, CHECK_OPTIONS, previewEntry, entryValuation, marketCurrency, contextsForCycle } from '@/lib/trade-entry.mjs';
import { StrategyConditions } from './strategy-conditions';
import { previewStrategyTransaction } from '@/lib/strategy-transaction.mjs';
import {TradeSection,TradeFillFields,PlanPriceFields,StandardPlanHelp} from './trade-plan-fields';
import {EntryMarketChart,useEntryMarket} from './entry-market-chart';
import {resolveSymbolMarket} from '@/lib/simple-entry.mjs';
import {InfoPopover,InfoPopoverGroup} from './info-popover';
import {historicalEntryStandard,resolveEntryPlan} from '@/lib/entry-standard-plan.mjs';
import { activeStrategyVersion } from '@/lib/strategy-engine.mjs';
import { toProviderSymbol } from '@/lib/quote-engine.mjs';

const number = (value: any, digits = 2) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US',{maximumFractionDigits:digits});
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

export function EntryContextEvidence({contexts={},cycleId,fills=[],selectedFillId,onSelect}: {contexts?:Record<string,any>;cycleId:string;fills?:any[];selectedFillId?:string;onSelect?:(fillId:string)=>void}) {
 const rows=contextsForCycle(contexts,cycleId);
 const [expanded,setExpanded]=useState<string|null>(null);
 const active=selectedFillId || expanded || rows.at(-1)?.fillId;
 return <section className="entry-context-evidence entry-v2"><h3>成交登錄證據</h3>{!rows.length?<p className="muted">此交易沒有保存登錄證據；不以目前行情或計畫推測。</p>:rows.map((row:any)=>{const fill=fills.find(f=>f.id===row.fillId||f.originalFillId===row.fillId);return <details key={row.fillId} open={active===row.fillId}><summary onClick={e=>{e.preventDefault();setExpanded(row.fillId);onSelect?.(row.fillId);}}>{ACTION_LABELS[row.action as keyof typeof ACTION_LABELS]}・{new Date(row.fillTimestamp).toLocaleString('zh-TW')}・{row.fillQuantity??fill?.quantity??'—'} 股</summary><div className="evidence-ticket">
 <TradeSection title="成交資料" help={<p>保存於 {row.recordedAt || '時間未記錄'}。以下為當時唯讀快照，不隨行情與計畫更新。</p>}><TradeFillFields currency={row.currency||fill?.currency||'USD'} value={{side:row.fillSide??fill?.side,quantity:row.fillQuantity??fill?.quantity,price:row.fillPrice??fill?.price,fee:row.fillFee??fill?.fee,timestamp:row.fillTimestamp}}/></TradeSection>
 <TradeSection title="策略確認" help={<p>原始成交確認不會被後續策略檢查覆寫。</p>}>{row.strategyStages?.length?row.strategyStages.filter((stage:any)=>stage.cycleId===cycleId).map((stage:any)=><div key={stage.id}><p>{stage.phase==='ENTRY'?'進場／加碼':'減碼／出場'} · {stage.strategyName||'未指定策略'} · {stage.strategyVersionId||'版本未記錄'}</p>{stage.versionSnapshot&&<StrategyConditions version={stage.versionSnapshot} value={stage.selection} phase={stage.phase} context={stage.conditionContext} mode="readonly"/>}<small>確認時間：{stage.confirmedAt||'未記錄'}</small>{stage.exception&&<p className="negative">當時確認例外登錄 · {stage.exceptionConfirmedAt}</p>}</div>):<><p>{row.strategyName||row.strategyId||'未指定策略'} · {row.strategyVersionId||'版本未記錄'}</p>{Object.entries(row.ruleChecks||{}).map(([id,check]:any)=><div className="entry-rule-row" key={id}><span>{check.name||id}</span><b>{optionLabel(CHECK_OPTIONS,check.status)}</b><InfoPopover label={check.name||id} mobilePresentation="sheet"><p>{check.criterion||'條件未記錄'}</p><p>確認時間：{check.checkedAt||'待確認'}</p></InfoPopover></div>)}</>}</TradeSection>
 <TradeSection title="整筆持倉計畫" help={<StandardPlanHelp standard={row.standardSnapshot} averageCost={row.after?.averageCost??row.standardSnapshot?.averageCost} currency={row.currency||'USD'}/>}><PlanPriceFields value={row.cycleId===cycleId?row.planSnapshot||{}:{}} position={row.cycleId===cycleId?row.after:null} currency={row.currency||'USD'} sources={row.standardSnapshot?.sources}/><small>備註：{row.note||'未填寫'}</small></TradeSection>
 <details><summary>保存時行情與估值證據</summary><p>取得時間：{row.evidence?.fetchedAt||'未記錄'}・估值時間：{row.valuation?.asOf||'未記錄'}</p><p>原部位浮動損益：{number(row.originalUnrealizedAtFill?.amount)} {row.currency}；停損資產影響 {percent(row.valuation?.stop?.assetChangePct)}。</p><div className="table-wrap"><table><thead><tr><th>日期</th><th>開</th><th>高</th><th>低</th><th>收</th><th>量</th></tr></thead><tbody>{(row.evidence?.candles||[]).map((bar:any)=><tr key={bar.date}><td>{bar.date}</td>{['open','high','low','close','volume'].map(k=><td key={k}>{number(bar[k],k==='volume'?0:4)}</td>)}</tr>)}</tbody></table></div>{row.evidence?.fillDayBar&&<p>成交日事後資料：{row.evidence.fillDayBar.date} 收 {number(row.evidence.fillDayBar.close)}；非成交當下已知資訊。</p>}{row.valuation?.reasons?.map((reason:string)=><p key={reason}>{reason}</p>)}</details>
 {row.formatVersion!==2&&<details><summary>舊版補充資訊</summary><p>進場：{optionLabel(ENTRY_OPTIONS,row.entrySetup)}；量價：{row.volumeTags?.map((tag:string)=>optionLabel(VOLUME_OPTIONS,tag)).join('、')||'未記錄'}；加碼：{optionLabel(ADD_OPTIONS,row.addReason)}</p></details>}
 </div></details>;})}</section>;
}

export function TradeEntryWorkspace({data,draft:incomingDraft,quotes,onChange,onSubmit}: {data:any;draft:any;quotes:Record<string,any>;onChange:(patch:any)=>void;onSubmit:(entry?:any)=>void|Promise<void>;onBack:()=>void}) {
 const {formatUsd:usd}=useValuation();
 const market=useEntryMarket(incomingDraft,data,quotes);
 const knownMarket=resolveSymbolMarket(data,incomingDraft.symbol,data.accounts.find((a:any)=>a.id===incomingDraft.accountId)?.currency,{...quotes,...market.quotes});
 const draft=useMemo(()=>({...incomingDraft,market:incomingDraft.marketConfirmed?incomingDraft.market:(knownMarket||incomingDraft.market)}),[incomingDraft,knownMarket]);
 const marketResolved=!!knownMarket||!!incomingDraft.marketConfirmed;
 const rawPreview=useMemo(()=>previewEntry(data,draft),[data,draft]);
 const standard=useMemo(()=>historicalEntryStandard(data,draft.timestamp),[data,draft.timestamp]);
 const effective=useMemo(()=>resolveEntryPlan({...draft,formatVersion:2,strategyFormatVersion:2},rawPreview,standard),[draft,rawPreview,standard]);
 const preview=useMemo(()=>previewEntry(data,effective),[data,effective]);
 const snapshot={quotes:market.quotes,capturedAt:new Date().toISOString()};
 const valuation=entryValuation(data,preview,effective,snapshot);
 const [error,setError]=useState(''),[submitting,setSubmitting]=useState(false);const guard=useRef(false);
 const change=(patch:any)=>{setError('');onChange({market:draft.market,...(['strategyId','strategyVersionId','strategySelections','ruleChecks','note'].some(key=>key in patch)?{strategyExceptionKey:''}:{}),...patch,formatVersion:2,strategyFormatVersion:2,updatedAt:new Date().toISOString()});};
 const basic=(patch:any)=>change({...patch,confirmedKey:'',strategyExceptionKey:''});
 const reset=(patch:any)=>basic({...patch,stopLoss:undefined,takeProfit:undefined,planModes:{},stopBasis:'UNSET',targetBasis:'UNSET',strategyId:'',strategyVersionId:'',ruleChecks:{},strategySelections:{}});
 const inherited=preview.assignment;
 const applicable=['ENTRY','ADD','REVERSAL'].includes(preview.action||'');
 const strategyTransaction=previewStrategyTransaction(data,effective,preview);
 const strategyConfirmed=!strategyTransaction.warnings.length||draft.strategyExceptionKey===strategyTransaction.confirmationKey;
 const confirmed=!!preview.confirmationKey&&draft.confirmedKey===preview.confirmationKey;
 const quote=market.quotes?.[toProviderSymbol(market.symbol,draft.market)];
 const unit=marketCurrency(draft.market);
 const fieldError=(label:string)=>{const key=({標的:'symbol',股數:'quantity',成交價:'price'} as Record<string,string>)[label];return key&&draft[key]===''?undefined:preview.errors.find((message:string)=>message.includes(label));};
 const submit=async()=>{
  if(guard.current)return;guard.current=true;setSubmitting(true);
  try {if(!marketResolved)throw new Error('請確認標的市場');await onSubmit({...effective,quoteSnapshot:snapshot,evidenceKey:market.identity,evidenceBars:market.bars,evidenceFetchedAt:market.fetchedAt,evidenceSource:market.source});}
  catch(cause){setError(cause instanceof Error?cause.message:'登錄失敗，請重試');guard.current=false;setSubmitting(false);}
 };
 return <InfoPopoverGroup><section className="trade-entry-workspace entry-v2"><form noValidate onSubmit={e=>{e.preventDefault();void submit();}}>
 <div className="entry-context-bar"><label>標的<input autoComplete="off" aria-invalid={!!fieldError('標的')} value={draft.symbol} onChange={e=>reset({symbol:e.target.value.toUpperCase(),marketConfirmed:false,market:resolveSymbolMarket(data,e.target.value,data.accounts.find((a:any)=>a.id===draft.accountId)?.currency,market.quotes)||draft.market})} placeholder="例：NVTS"/>{fieldError('標的')&&<small className="entry-warning">{fieldError('標的')}</small>}</label><details className="entry-market-setting" open={!!draft.symbol&&!marketResolved}><summary>{marketResolved?`市場設定 · ${draft.market}`:'請確認標的市場'}</summary><label>市場<select value={marketResolved?draft.market:''} onChange={e=>reset({market:e.target.value,marketConfirmed:true})}><option value="">選擇交易所</option>{['NASDAQ','NYSE','AMEX','TWSE','TPEX'].map(m=><option key={m}>{m}</option>)}</select></label></details><label>交易帳戶<select value={draft.accountId} onChange={e=>{const a=data.accounts.find((a:any)=>a.id===e.target.value);reset({accountId:a.id,marketConfirmed:false,market:a.currency==='TWD'?'TWSE':'NASDAQ'});}}>{data.accounts.map((a:any)=><option key={a.id} value={a.id}>{a.name}・{a.currency}</option>)}</select>{fieldError('帳戶')&&<small className="entry-warning">{fieldError('帳戶')}</small>}</label><div className="entry-live-quote"><span>最新價格</span><b>{quote?`${quote.currency} ${number(quote.price,4)}`:'—'}</b>{quote?.updatedAt&&<small>{new Date(quote.updatedAt).toLocaleTimeString('zh-TW')}</small>}</div></div>
 <div className="entry-ticket-grid"><EntryMarketChart key={`${draft.accountId}:${draft.market}:${market.symbol}`} market={market} draft={effective} preview={preview} data={data}/><div className="entry-ticket-form">
 <TradeSection title="成交資料" help={<p>只登錄已發生的成交；成交價不會隨行情自動改寫。買賣方向與 FIFO 庫存決定操作。</p>}><TradeFillFields value={draft} currency={unit} onChange={basic} onSideChange={side=>reset({side})} errors={fieldError}/></TradeSection>
 <TradeSection title="策略確認" help={<p>進場確認市場與進場條件；減碼和平倉確認出場條件。反手分別保存原部位出場及新部位進場。加碼不覆寫原始開倉紀錄。</p>}>
 {applicable&&!inherited&&<label className="entry-strategy-select">新部位主策略<select aria-label="主策略" value={draft.strategyId} onChange={e=>{const selected=(data.strategies||[]).find((item:any)=>item.id===e.target.value);change({strategyId:e.target.value,strategyVersionId:activeStrategyVersion(selected)?.id||'',ruleChecks:{},strategySelections:{...draft.strategySelections,ENTRY:{}}});}}><option value="">未指定策略（可待補）</option>{(data.strategies||[]).filter((item:any)=>item.status==='ACTIVE'&&activeStrategyVersion(item)).map((item:any)=><option key={item.id} value={item.id}>{item.name} · v{activeStrategyVersion(item).version}</option>)}</select></label>}
 {strategyTransaction.stages.map((stage:any)=><div key={stage.id} className="entry-strategy-stage"><p><b>{stage.phase==='ENTRY'?'進場／加碼':'減碼／出場'}</b> · {stage.strategyName||'未指定策略'}{stage.versionSnapshot?` · v${stage.versionSnapshot.version}`:''}{stage.inherited&&<small> 沿用原策略</small>}</p>{stage.versionSnapshot?<StrategyConditions version={stage.versionSnapshot} value={stage.selection} phase={stage.phase} context={stage.conditionContext} onChange={value=>change({strategySelections:{...draft.strategySelections,[stage.phase]:value}})}/>:<small className="muted">未指定策略，保存後保留為待補。</small>}</div>)}
 {!preview.action&&<small>填妥成交資料後顯示本次策略條件。</small>}
 </TradeSection>
 <section><div className="entry-section-title"><h3>整筆持倉計畫</h3><InfoPopover label="歷史標準" mobilePresentation="sheet"><StandardPlanHelp standard={standard} averageCost={preview.after?.averageCost} currency={unit}/></InfoPopover>{preview.after&&<button type="button" className="entry-standard-button" onClick={()=>change({stopLoss:undefined,takeProfit:undefined,planModes:{stopLoss:'STANDARD',takeProfit:'STANDARD'}})}>套用標準</button>}</div>{preview.after?<PlanPriceFields value={effective} position={preview.after} currency={unit} sources={effective.standardSnapshot.sources} onChange={(field,value)=>change({[field]:value,planModes:{...draft.planModes,[field]:'MANUAL'}})}/>:<small>{preview.action==='EXIT'?'平倉後無剩餘部位，不新增停利停損。':'填妥成交後顯示標準計畫。'}</small>}{['停利價','停損價'].map(label=>fieldError(label)&&<small className="entry-warning" key={label}>{fieldError(label)}</small>)}{preview.after&&Number(effective.stopLoss)>0&&valuation.mark&&(preview.after.direction==='SHORT'?Number(effective.stopLoss)<=valuation.mark:Number(effective.stopLoss)>=valuation.mark)&&<small className="entry-warning">停損已越過參考現價，請檢查計畫。</small>}</section>
 <label className="entry-note">備註<input value={draft.note} onChange={e=>change({note:e.target.value})} placeholder="選填：本次成交的補充說明"/></label>
 </div></div>
 <footer className="entry-confirmation-bar">{strategyTransaction.warnings.length>0&&<div className="strategy-exception"><span>{strategyTransaction.warnings.join('；')}</span><label><input type="checkbox" checked={strategyConfirmed} onChange={e=>change({strategyExceptionKey:e.target.checked?strategyTransaction.confirmationKey:''})}/>已了解條件未符合或待補，仍登錄實際成交</label></div>}<div className="entry-impact-strip"><div><span>操作／股數</span><b>{ACTION_LABELS[preview.action as keyof typeof ACTION_LABELS]||'待填成交'}・{number(preview.before?.quantity||0,4)} → {number(preview.after?.quantity||0,4)}</b></div><div><span>持倉占比</span><b>{percent(valuation.positionPct)}</b></div><div><span>停損資產影響</span><b className="negative">{percent(valuation.stop?.assetChangePct)}</b></div><InfoPopover label="操作與資產影響" mobilePresentation="sheet"><p>方向：{preview.before?.direction||'無'} → {preview.after?.direction||'無'}；FIFO 均價 {number(preview.before?.averageCost,4)} → {number(preview.after?.averageCost,4)} {unit}。</p><p>登錄後淨值 {usd(valuation.navUsd)}；新增占比 {percent(valuation.addedPct)}。</p><p>停利情境 {percent(valuation.target?.assetChangePct)}／{usd(valuation.target?.assetChangeUsd)}；停損情境 {percent(valuation.stop?.assetChangePct)}／{usd(valuation.stop?.assetChangeUsd)}。</p><p>相對成本預估損益：停利 {usd(valuation.target?.costPnlUsd)}／停損 {usd(valuation.stop?.costPnlUsd)}。以上為整筆剩餘持倉的情境，非已實現損益。</p><p>參考現價 {number(valuation.mark,4)}；USD/TWD {number(valuation.fxRate,4)}。</p>{valuation.reasons.map((r:string)=><p key={r}>{r}</p>)}</InfoPopover></div><div className="entry-submit-controls"><label className="entry-confirm"><input type="checkbox" checked={confirmed} disabled={!preview.confirmationKey} onChange={e=>change({confirmedKey:e.target.checked?preview.confirmationKey:''})}/>確認操作與股數</label><button className="primary" type="submit" disabled={submitting||!marketResolved||!!preview.errors.length||!confirmed||!strategyConfirmed}>{submitting?'登錄中…':'登錄成交與計畫'}</button></div>{preview.sameTime&&<small className="entry-warning">同時間已有成交，本筆排於既有成交之後。</small>}{preview.affected.length>0&&<p role="alert" className="entry-warning">補登後會自動重算閉環，原註記將保留；無法明確對應者需重新核對：{preview.affected.map((c:any)=>c.symbol+' '+c.openAt).join('、')}</p>}{error&&<p role="alert" className="entry-warning">{error}</p>}<small className="entry-submit-note">提交一次保存成交、策略與計畫；不會送出券商訂單。</small></footer>
 </form></section></InfoPopoverGroup>;
}
