export const ARRAY_SECTIONS=['accounts','fills','cashActivities','planHistory','decisionLinkHistory','improvementExperiments','strategies'];
export const MAP_SECTIONS=['positionPlans','cycleReviews','decisionLinks','strategyAssignments','entryContexts'];
const RESERVED=new Set([...ARRAY_SECTIONS,...MAP_SECTIONS,'profile','settings','marketBars','marketSnapshot','dashboardSummary','_storage']);
const idText=value=>String(value??'').slice(0,240);
const rowId=(value,index)=>idText(value&&typeof value==='object'&&(value.id??value.batchId??value.key??value.cycleId??value.strategyId)||`index:${index}`)||`index:${index}`;
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const json=value=>JSON.stringify(ordered(value??null));

export function normalizedDatasetEntries(dataset){
 const entries=[];
 for(const section of ARRAY_SECTIONS){const used=new Set();for(const [ordinal,value] of (Array.isArray(dataset?.[section])?dataset[section]:[]).entries()){let entityId=rowId(value,ordinal);if(used.has(entityId))entityId=`${entityId}#${ordinal}`;used.add(entityId);entries.push({section,entityId,ordinal,value});}}
 for(const section of MAP_SECTIONS)for(const [entityId,value] of Object.entries(dataset?.[section]&&typeof dataset[section]==='object'&&!Array.isArray(dataset[section])?dataset[section]:{}))entries.push({section,entityId:idText(entityId),ordinal:null,value});
 const extensions={};for(const [key,value] of Object.entries(dataset||{}))if(!RESERVED.has(key))extensions[key]=value;
 entries.push({section:'profile',entityId:'profile',ordinal:null,value:dataset?.profile||{name:'我的交易帳本',baseCurrency:'USD',costMethod:'FIFO'}});
 entries.push({section:'settings',entityId:'settings',ordinal:null,value:dataset?.settings||{quoteProvider:'json',benchmarkSymbol:'SPY'}});
 entries.push({section:'extensions',entityId:'extensions',ordinal:null,value:extensions});
 return entries;
}

const entryMap=dataset=>new Map(normalizedDatasetEntries(dataset).map(entry=>[`${entry.section}\u0000${entry.entityId}`,entry]));
export function diffNormalizedDatasets(previous,next){
 const before=entryMap(previous),after=entryMap(next),operations=[];
 for(const [key,entry] of after){const old=before.get(key);if(!old||old.ordinal!==entry.ordinal||json(old.value)!==json(entry.value))operations.push({section:entry.section,entityId:entry.entityId,action:'upsert',ordinal:entry.ordinal,value:entry.value});before.delete(key);}
 for(const entry of before.values())operations.push({section:entry.section,entityId:entry.entityId,action:'delete'});
 return operations;
}

export function applyNormalizedOperations(dataset,operations){
 const next=structuredClone(dataset),arraySets=new Map();
 for(const operation of operations||[]){
  if(!operation||!['upsert','delete'].includes(operation.action))throw Error('Invalid ledger operation');
  if(ARRAY_SECTIONS.includes(operation.section)){
   if(!arraySets.has(operation.section))arraySets.set(operation.section,new Map(normalizedDatasetEntries(next).filter(entry=>entry.section===operation.section).map(entry=>[entry.entityId,entry])));
   const values=arraySets.get(operation.section);if(operation.action==='delete')values.delete(operation.entityId);else values.set(operation.entityId,{section:operation.section,entityId:operation.entityId,ordinal:operation.ordinal??Number.MAX_SAFE_INTEGER,value:structuredClone(operation.value)});
   continue;
  }
  if(MAP_SECTIONS.includes(operation.section)){const current=next[operation.section]&&typeof next[operation.section]==='object'&&!Array.isArray(next[operation.section])?{...next[operation.section]}:{};if(operation.action==='delete')delete current[operation.entityId];else current[operation.entityId]=structuredClone(operation.value);next[operation.section]=current;continue;}
  if(operation.section==='extensions'){
   for(const key of Object.keys(next))if(!RESERVED.has(key))delete next[key];if(operation.action==='upsert')Object.assign(next,structuredClone(operation.value));continue;
  }
  if(['profile','settings'].includes(operation.section)){if(operation.action==='delete')throw Error('Required ledger document cannot be deleted');next[operation.section]=structuredClone(operation.value);continue;}
  throw Error('Unknown ledger section');
 }
 for(const [section,values] of arraySets)next[section]=[...values.values()].sort((a,b)=>(a.ordinal??Number.MAX_SAFE_INTEGER)-(b.ordinal??Number.MAX_SAFE_INTEGER)||a.entityId.localeCompare(b.entityId)).map(entry=>entry.value);
 return next;
}

export async function createLedgerMutation(accountId,baseVersion,operations){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({accountId,version:baseVersion,operations})));
 return {baseVersion,mutationId:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join(''),operations};
}
