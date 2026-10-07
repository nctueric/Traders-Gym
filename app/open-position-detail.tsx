/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {DialogFrame,SectionLinks} from './workspace-ui';
import {ReplayBoard} from './training-workspace';
import {EntryContextEvidence} from './trade-entry-workspace';
import {StrategyChecklist} from './strategy-workspace';
import {InfoPopoverGroup} from './info-popover';
import {PlanPriceFields,TradeSection,StandardPlanHelp} from './trade-plan-fields';
import {historicalEntryStandard,resolveEntryPlan} from '@/lib/entry-standard-plan.mjs';
const makeDraft=(plan:any)=>({takeProfit:plan.takeProfit??'',stopLoss:plan.stopLoss??'',note:plan.note||'',reason:'',planModes:{...plan.sources} as any,standardSnapshot:null as any});
export function OpenPositionDetail({data,entryContexts,initialEventId,position,plan,marketBars,planHistory,strategies,strategyAssignments,onAssignStrategy,onStrategyCheck,onStageReview,onAddPlanVersion,onSavePlan,onOpenAnalysis,onClose}:any) {
 const [positionBasis]=useState(()=>({quantity:position.quantity,averageCost:position.averageCost}));
 const [draft,setDraft]=useState(()=>makeDraft(plan));
 const [focus,setFocus]=useState<string|null>(initialEventId||null);
 const [saving,setSaving]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const [baseline,setBaseline]=useState(()=>makeDraft(plan));const [pending,setPending]=useState<string|null>(null);const guard=useRef(false);
 const dirty=['takeProfit','stopLoss','note'].some(k=>String((draft as any)[k])!==String((baseline as any)[k]));
 const [leave,setLeave]=useState<'close'|'analysis'|null>(null);
 const standard=useMemo(()=>historicalEntryStandard(data,new Date().toISOString()),[data]);
 const openCycle={...position,status:'OPEN',averageEntry:position.averageCost,closeAt:new Date().toISOString()};
 const selectedFill=focus?.startsWith('fill:')?focus.slice(5):focus?.startsWith('entry-context:')?focus.slice(14):undefined;
 const versions=(planHistory||[]).filter((v:any)=>v.cycleId===position.id);
 const batches=Object.values(versions.reduce((groups:any,v:any)=>{const id=v.batchId||v.id;(groups[id]??=[]).push(v);return groups;},{})) as any[][];
 useEffect(()=>{if(!dirty&&!error)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,error]);
 function exit(action:'close'|'analysis'){if(saving)return;if(dirty||error)setLeave(action);else (action==='close'?onClose:onOpenAnalysis)();}
 function change(patch:any){if(saving||pending)return;setDraft(d=>({...d,...patch}));setStatus('');}
 function applyStandard(){const s=historicalEntryStandard(data,new Date().toISOString());const next=resolveEntryPlan({planModes:{takeProfit:'STANDARD',stopLoss:'STANDARD'}},{after:position,plan,action:'ADD'},s);change({takeProfit:next.takeProfit,stopLoss:next.stopLoss,planModes:next.planModes,standardSnapshot:next.standardSnapshot});}
 async function save(){if(guard.current)return;guard.current=true;setSaving(true);setError('');const batchId=pending||`plan-edit-${crypto.randomUUID()}`;setPending(batchId);
  try{await onSavePlan(position,{...draft,positionBasis},batchId);setBaseline({...draft});setPending(null);setStatus('計畫已儲存至雲端。');}
  catch(cause){if(!(cause as any)?.submitted)setPending(null);setError(cause instanceof Error?cause.message:'儲存失敗，請重試');}
  finally{guard.current=false;setSaving(false);}
 }
 return <DialogFrame className="detail-dialog" label={`${position.symbol} 持倉 K 線與交易計畫`} onClose={()=>exit('close')}><InfoPopoverGroup><article className="cycle-detail-modal entry-v2 position-detail-v2"><div className="panel-head detail-header"><div><h2>{position.symbol} 持倉交易計畫</h2><small>{position.direction==='SHORT'?'空單':'多單'}・{position.quantity} 股・FIFO 均價 {position.averageCost} {position.currency}</small></div><div className="open-position-actions"><button type="button" className="ghost" onClick={()=>exit('analysis')}>查看交易行為分析</button><button type="button" className="close" aria-label="關閉視窗" onClick={()=>exit('close')}>×</button></div></div>
 {leave&&<div role="alert" className="plan-leave-prompt"><b>{pending?'計畫已送出但尚未確認儲存，離開仍會保留待同步資料。':'尚有未儲存的計畫修改。'}</b><button type="button" onClick={()=>setLeave(null)}>繼續編輯</button><button type="button" onClick={()=>(leave==='close'?onClose:onOpenAnalysis)()}>{pending?'保留待同步並離開':'捨棄草稿並離開'}</button></div>}
 <SectionLinks label="持倉詳情區段" links={[{id:'position-replay',label:'K 線與事件'},{id:'position-evidence',label:'成交證據'},{id:'position-plan',label:'目前計畫'}]}/>
 <div id="position-replay" tabIndex={-1}><ReplayBoard cycle={openCycle} marketBars={marketBars} planHistory={planHistory} review={{}} rapidPairs={[]} decisionLinks={{}} strategies={strategies} strategyAssignments={strategyAssignments} entryContexts={entryContexts} openPlan={plan} onAddPlanVersion={onAddPlanVersion} showPlanEditor={false} showEntryEvidence={false} activeEventId={focus} onEventSelect={setFocus}/></div>
 <div id="position-evidence" tabIndex={-1}><EntryContextEvidence contexts={entryContexts} cycleId={position.id} fills={position.fills} selectedFillId={selectedFill} onSelect={id=>setFocus(`fill:${id}`)}/></div>
 <details className="position-strategy-followup"><summary>後續策略檢查（不修改原始成交證據）</summary><StrategyChecklist cycle={position} strategies={strategies} assignment={strategyAssignments[position.id]} phase="pre" onStageReview={onStageReview} onAssign={onAssignStrategy} onCheck={onStrategyCheck}/></details>
 <section id="position-plan" className="position-plan-editor" tabIndex={-1}><TradeSection title="整筆持倉計畫" help={<StandardPlanHelp standard={draft.standardSnapshot||standard} averageCost={position.averageCost} currency={position.currency}/>} actions={<button type="button" className="entry-standard-button" disabled={saving||!!pending} onClick={applyStandard}>套用標準</button>}><fieldset disabled={saving||!!pending}><PlanPriceFields value={draft} position={position} currency={position.currency} sources={{takeProfit:'ORIGINAL',stopLoss:'ORIGINAL',...draft.planModes}} onChange={(field,value)=>change({[field]:value,planModes:{...draft.planModes,[field]:'MANUAL'}})}/><label className="entry-note">計畫與失效條件<input value={draft.note} onChange={e=>change({note:e.target.value})}/></label><label className="entry-note">修改備註<input value={draft.reason} onChange={e=>change({reason:e.target.value})} placeholder="選填：本次調整原因"/></label></fieldset><div className="plan-save-actions"><button type="button" disabled={saving||!!pending||!dirty} onClick={()=>{setDraft(makeDraft(plan));setBaseline(makeDraft(plan));setError('');setStatus('');}}>取消修改</button><button type="button" className="primary" disabled={saving||(!dirty&&!error)} onClick={save}>{saving?'儲存中…':error?'重試儲存':'儲存計畫'}</button><span role="status">{status}</span></div>{error&&<p role="alert" className="negative">{error}。草稿保留；請重試，不會重複建立版本。</p>}</TradeSection></section>
 <details className="position-plan-history"><summary>交易計畫歷程・{batches.length} 次</summary>{batches.slice().reverse().map(batch=><article key={batch[0].batchId||batch[0].id}><b>{new Date(batch[0].createdAt).toLocaleString('zh-TW')}</b><small>{batch[0].reason||'未填修改備註'}</small>{batch.map(v=><p key={v.id}>{v.field==='stopLoss'?'停損':v.field==='takeProfit'?'停利':'失效條件'}：{v.previousValue??'先前值未記錄'} → {v.value??'未設定'}・{v.source==='HISTORICAL_STANDARD'?'歷史標準':v.source||'舊紀錄'}</p>)}</article>)}</details>
 </article></InfoPopoverGroup></DialogFrame>;
}
