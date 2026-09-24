import {buildCycles} from './trade-engine.mjs';
export function commitPositionPlanEdit(data, position, draft, now, batchId) {
  const key=position.id || `${position.accountId}:${position.symbol}`;
  const existing=data.positionPlans?.[key] || data.positionPlans?.[`${position.accountId}:${position.symbol}`] || {};
  if((data.planHistory || []).some(v=>v.batchId===batchId))return data;
  if(draft.positionBasis){const current=buildCycles(data).positions.find(p=>p.id===position.id);if(!current||current.quantity!==draft.positionBasis.quantity||current.averageCost!==draft.positionBasis.averageCost)throw new Error('持倉已變動，請關閉後重新開啟計畫確認');}
  const plan={...existing}, versions=[];
  for(const field of ['takeProfit','stopLoss','note']){
    if(draft[field]===undefined)continue;
    const raw=draft[field];const value=field==='note'?String(raw||''):raw===''||raw==null?null:Number(raw);
    if(field!=='note'&&value!==null&&(!Number.isFinite(value)||value<=0))throw new Error(`${field==='stopLoss'?'停損':'停利'}價必須為正數或留空`);
    const previous=existing[field] ?? (field==='note'?'':null);
    if(value===previous)continue;
    const version={id:`${batchId}-${field}`,batchId,cycleId:position.id,accountId:position.accountId,symbol:position.symbol,field:field==='note'?'invalidation':field,value,previousValue:previous,reason:String(draft.reason||''),createdAt:now,effectiveAt:now,source:draft.planModes?.[field]==='STANDARD'?'HISTORICAL_STANDARD':'USER',standardSnapshot:draft.planModes?.[field]==='STANDARD'?{...draft.standardSnapshot,sources:{...draft.standardSnapshot?.sources,...draft.planModes}}:null};
    versions.push(version);plan[field]=value;plan.sources={...plan.sources,[field]:draft.planModes?.[field]||"MANUAL"};plan.references={...plan.references,[version.field]:version.id};
  }
  if(!versions.length)return data;
  return {...data,positionPlans:{...data.positionPlans,[key]:{...plan,updatedAt:now}},planHistory:[...(data.planHistory||[]),...versions]};
}
