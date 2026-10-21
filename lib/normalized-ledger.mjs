import {logLedgerWrites} from './storage-retry.mjs';
import {authError,emptyDataset,sha256} from './auth-core.mjs';
import {buildHomeView,homeViewStatement} from './home-views.mjs';
import {completeTradeDataset,durableTradeDataset,isDataset} from './trade-record-store.mjs';

export const NORMALIZED_STORAGE_MODES=new Set(['shadow','normalized']);
export const ARRAY_SECTIONS={
 accounts:'ledger_accounts',fills:'ledger_fills',cashActivities:'ledger_cash_activities',planHistory:'ledger_plan_history',
 decisionLinkHistory:'ledger_decision_link_history',improvementExperiments:'ledger_improvement_experiments',strategies:'ledger_strategies',
};
export const MAP_SECTIONS={
 positionPlans:'ledger_position_plans',cycleReviews:'ledger_cycle_reviews',decisionLinks:'ledger_decision_links',
 strategyAssignments:'ledger_strategy_assignments',entryContexts:'ledger_entry_contexts',
};
export const DOCUMENT_SECTIONS=new Set(['profile','settings','extensions']);
const RESERVED=new Set([...Object.keys(ARRAY_SECTIONS),...Object.keys(MAP_SECTIONS),'profile','settings','marketBars','marketSnapshot','dashboardSummary','_storage']);
const TABLES={...ARRAY_SECTIONS,...MAP_SECTIONS};
const idText=value=>String(value??'').slice(0,240);
const rowId=(section,value,index)=>{
 const candidate=value&&typeof value==='object'&&(value.id??value.batchId??value.key??value.cycleId??value.strategyId);
 return idText(candidate||`index:${index}`)||`index:${index}`;
};
const sortKey=value=>idText(value?.timestamp??value?.date??value?.createdAt??value?.updatedAt??'');
const symbol=value=>idText(value?.symbol??'').slice(0,80)||null;
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const json=value=>JSON.stringify(ordered(value??null));
const canonicalValue=value=>{
 if(Array.isArray(value))return value.map(canonicalValue);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalValue(value[key])]));
 return value;
};
const canonicalDurableJson=dataset=>{
 const comparable={...dataset};
 for(const section of Object.keys(ARRAY_SECTIONS))comparable[section]=Array.isArray(dataset?.[section])?dataset[section]:[];
 for(const section of Object.keys(MAP_SECTIONS))comparable[section]=dataset?.[section]&&typeof dataset[section]==='object'&&!Array.isArray(dataset[section])?dataset[section]:{};
 comparable.profile=dataset?.profile||emptyDataset().profile;comparable.settings=dataset?.settings||emptyDataset().settings;
 return JSON.stringify(canonicalValue(durableTradeDataset(comparable)));
};

export function normalizedDatasetEntries(dataset){
 const entries=[];
 for(const [section] of Object.entries(ARRAY_SECTIONS)){
  const used=new Set();
  for(const [ordinal,value] of (Array.isArray(dataset?.[section])?dataset[section]:[]).entries()){
   let entityId=rowId(section,value,ordinal);if(used.has(entityId))entityId=`${entityId}#${ordinal}`;used.add(entityId);
   entries.push({section,entityId,ordinal,value});
  }
 }
 for(const [section] of Object.entries(MAP_SECTIONS))for(const [entityId,value] of Object.entries(dataset?.[section]&&typeof dataset[section]==='object'&&!Array.isArray(dataset[section])?dataset[section]:{}))entries.push({section,entityId:idText(entityId),ordinal:null,value});
 const extensions={};for(const [key,value] of Object.entries(dataset||{}))if(!RESERVED.has(key))extensions[key]=value;
 entries.push({section:'profile',entityId:'profile',ordinal:null,value:dataset?.profile||emptyDataset().profile});
 entries.push({section:'settings',entityId:'settings',ordinal:null,value:dataset?.settings||emptyDataset().settings});
 entries.push({section:'extensions',entityId:'extensions',ordinal:null,value:extensions});
 return entries;
}

function entryMap(dataset){return new Map(normalizedDatasetEntries(dataset).map(entry=>[`${entry.section}\u0000${entry.entityId}`,entry]));}
export function diffNormalizedDatasets(previous,next){
 const before=entryMap(previous),after=entryMap(next),operations=[];
 for(const [key,entry] of after){const old=before.get(key);if(!old||old.ordinal!==entry.ordinal||json(old.value)!==json(entry.value))operations.push({section:entry.section,entityId:entry.entityId,action:'upsert',ordinal:entry.ordinal,value:entry.value});before.delete(key);}
 for(const entry of before.values())operations.push({section:entry.section,entityId:entry.entityId,action:'delete'});
 return operations;
}

export function validateLedgerMutation(value,{maxBytes=2_000_000,maxOperations=2000}={}){
 if(!value||typeof value!=='object')return {ok:false,error:'請提供增量操作'};
 const baseVersion=Number(value.baseVersion),mutationId=String(value.mutationId||'');
 if(!Number.isInteger(baseVersion)||baseVersion<1)return {ok:false,error:'資料版本格式無效'};
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(mutationId))return {ok:false,error:'操作識別碼格式無效'};
 if(!Array.isArray(value.operations)||!value.operations.length||value.operations.length>maxOperations)return {ok:false,error:'增量操作數量無效'};
 const operations=[];
 for(const raw of value.operations){
  const section=String(raw?.section||''),entityId=String(raw?.entityId||''),action=String(raw?.action||'');
  if((!TABLES[section]&&!DOCUMENT_SECTIONS.has(section))||!entityId||entityId.length>240||!['upsert','delete'].includes(action))return {ok:false,error:'增量操作格式無效'};
  if(DOCUMENT_SECTIONS.has(section)&&entityId!==section)return {ok:false,error:'文件操作識別碼無效'};
  if(action==='upsert'&&!Object.hasOwn(raw,'value'))return {ok:false,error:'增量操作缺少資料'};
  const ordinal=raw.ordinal==null?null:Number(raw.ordinal);if(ordinal!=null&&(!Number.isInteger(ordinal)||ordinal<0))return {ok:false,error:'增量排序格式無效'};
  operations.push({section,entityId,action,ordinal,...(action==='upsert'?{value:raw.value}:{})});
 }
 const operationsJson=JSON.stringify(operations);if(new TextEncoder().encode(operationsJson).length>maxBytes)return {ok:false,error:'增量操作超過大小上限'};
 return {ok:true,baseVersion,mutationId,operations,operationsJson};
}

function operationStatement(db,accountId,version,operation){
 if(DOCUMENT_SECTIONS.has(operation.section)){
  if(operation.action==='delete')return db.prepare('DELETE FROM ledger_documents WHERE account_id=? AND section=?').bind(accountId,operation.section);
  return db.prepare('INSERT INTO ledger_documents(account_id,section,payload_json,updated_version) VALUES(?,?,?,?) ON CONFLICT(account_id,section) DO UPDATE SET payload_json=excluded.payload_json,updated_version=excluded.updated_version').bind(accountId,operation.section,json(operation.value),version);
 }
 const table=TABLES[operation.section];
 if(operation.action==='delete')return db.prepare(`DELETE FROM ${table} WHERE account_id=? AND entity_id=?`).bind(accountId,operation.entityId);
 return db.prepare(`INSERT INTO ${table}(account_id,entity_id,ordinal,sort_key,symbol,payload_json,updated_version) VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id,entity_id) DO UPDATE SET ordinal=excluded.ordinal,sort_key=excluded.sort_key,symbol=excluded.symbol,payload_json=excluded.payload_json,updated_version=excluded.updated_version`).bind(accountId,operation.entityId,operation.ordinal,sortKey(operation.value),symbol(operation.value),json(operation.value),version);
}

export async function normalizedReplacementStatements({db,accountId,dataset,version,storageMode='shadow',projectionVersion=version,snapshotVersion=version}){
 if(!isDataset(dataset)||!NORMALIZED_STORAGE_MODES.has(storageMode))throw authError('正規化帳本資料無效',400);
 const core=await readNormalizedCore(db,accountId);
 const before=mergeNormalizedCore({},core),operations=diffNormalizedDatasets(before,dataset);
 // Missing document defaults must still be materialized on the first backfill.
 for(const section of ['profile','settings','extensions'])if(!Object.hasOwn(core,section)&&!operations.some(op=>op.section===section))operations.push({section,entityId:section,action:'upsert',value:normalizedDatasetEntries(dataset).find(e=>e.section===section).value});
 const statements=operations.map(operation=>operationStatement(db,accountId,version,operation));
 const now=new Date().toISOString();statements.push(db.prepare(`INSERT INTO normalized_ledger_state(account_id,storage_mode,normalized_version,projection_version,snapshot_version,projection_pending,snapshot_pending,last_error,updated_at) VALUES(?,?,?,?,?,0,0,NULL,?) ON CONFLICT(account_id) DO UPDATE SET storage_mode=excluded.storage_mode,normalized_version=excluded.normalized_version,projection_version=excluded.projection_version,snapshot_version=excluded.snapshot_version,projection_pending=0,snapshot_pending=0,last_error=NULL,updated_at=excluded.updated_at`).bind(accountId,storageMode,version,projectionVersion,snapshotVersion,now));
 return {statements,operations};
}
export async function replaceNormalizedDataset(options){
 const {statements,operations}=await normalizedReplacementStatements(options);
 const result=await options.db.batch(statements);logLedgerWrites('replacement',result,operations.length);
 return {accountId:options.accountId,version:options.version,storageMode:options.storageMode||'shadow',entities:operations.length};
}

export async function readNormalizedCore(db,accountId){
 const sections={},statements=[];for(const table of Object.values(TABLES))statements.push(db.prepare(`SELECT entity_id,ordinal,payload_json FROM ${table} WHERE account_id=? ORDER BY COALESCE(ordinal,2147483647),entity_id`).bind(accountId));
 statements.push(db.prepare('SELECT section,payload_json FROM ledger_documents WHERE account_id=?').bind(accountId));
 const results=await db.batch(statements);let index=0;
 for(const section of Object.keys(TABLES)){
  const rows=results[index++].results||[];
  if(Object.hasOwn(ARRAY_SECTIONS,section))sections[section]=rows.map(row=>JSON.parse(row.payload_json));
  else sections[section]=Object.fromEntries(rows.map(row=>[row.entity_id,JSON.parse(row.payload_json)]));
 }
 for(const row of results[index].results||[])sections[row.section]=JSON.parse(row.payload_json);
 return sections;
}

export function mergeNormalizedCore(base,core){
 const merged={...completeTradeDataset(base||{}),...(core.extensions||{})};
 for(const section of [...Object.keys(ARRAY_SECTIONS),...Object.keys(MAP_SECTIONS),'profile','settings'])if(Object.hasOwn(core,section))merged[section]=core[section];
 delete merged.extensions;return merged;
}

async function loadSnapshotDataset(objects,row){
 if(row.object_key){if(!objects)throw authError('完整快照儲存尚未設定',503);const object=await objects.get(row.object_key);if(!object)throw authError('找不到背景快照',503);const text=await object.text();if(object.customMetadata?.sha256&&object.customMetadata.sha256!==await sha256(text))throw authError('背景快照校驗失敗',503);return JSON.parse(text);}
 return JSON.parse(row.dataset_json||'{}');
}
export async function readNormalizedDataset({db,objects,row}){return mergeNormalizedCore(await loadSnapshotDataset(objects,row),await readNormalizedCore(db,row.account_id));}

export async function commitNormalizedMutation({db,accountId,ownerId,checked,saveMode='auto'}){
 const duplicate=await db.prepare('SELECT m.committed_version,m.committed_at,s.account_name FROM ledger_mutations m JOIN trade_account_snapshots s ON s.account_id=m.account_id WHERE m.account_id=? AND m.mutation_id=? AND s.owner_user_id=?').bind(accountId,checked.mutationId,ownerId).first();
 if(duplicate)return {id:accountId,name:duplicate.account_name,storageMode:'normalized',duplicate:true,version:duplicate.committed_version,updatedAt:duplicate.committed_at};
 const state=await db.prepare(`SELECT n.storage_mode,n.normalized_version,s.version,s.account_name FROM normalized_ledger_state n JOIN trade_account_snapshots s ON s.account_id=n.account_id WHERE n.account_id=? AND s.owner_user_id=? AND s.deleted_at IS NULL AND s.archived_at IS NULL`).bind(accountId,ownerId).first();
 if(!state||state.storage_mode!=='normalized')throw authError('此帳本尚未啟用增量儲存',428);
 if(state.version!==checked.baseVersion||state.normalized_version!==checked.baseVersion)throw authError('資料版本不一致；請先重新載入後再操作',409);
 const now=new Date().toISOString(),version=checked.baseVersion+1,statements=[db.prepare('INSERT INTO ledger_mutations(account_id,mutation_id,base_version,committed_version,operations_json,committed_at) VALUES(?,?,?,?,?,?)').bind(accountId,checked.mutationId,checked.baseVersion,version,checked.operationsJson,now)];
 for(const operation of checked.operations)statements.push(operationStatement(db,accountId,version,operation));
 statements.push(db.prepare(`UPDATE trade_account_snapshots SET version=?,updated_at=?,save_mode=? WHERE account_id=? AND owner_user_id=? AND version=? RETURNING account_id,account_name,version,updated_at`).bind(version,now,saveMode==='manual'?'incremental-manual':'incremental-auto',accountId,ownerId,checked.baseVersion));
 statements.push(db.prepare('INSERT INTO ledger_change_log(account_id,version,mutation_id,operations_json,committed_at) VALUES(?,?,?,?,?)').bind(accountId,version,checked.mutationId,checked.operationsJson,now));
 statements.push(db.prepare(`UPDATE normalized_ledger_state SET normalized_version=?,projection_pending=1,snapshot_pending=1,last_error=NULL,updated_at=? WHERE account_id=? AND normalized_version=?`).bind(version,now,accountId,checked.baseVersion));
 let result;try{result=await db.batch(statements);}catch(error){
  const replay=await db.prepare('SELECT committed_version,committed_at FROM ledger_mutations WHERE account_id=? AND mutation_id=?').bind(accountId,checked.mutationId).first();if(replay)return {id:accountId,name:state.account_name,storageMode:'normalized',duplicate:true,version:replay.committed_version,updatedAt:replay.committed_at};
  if(/LEDGER_VERSION_CONFLICT|UNIQUE constraint failed: ledger_mutations.account_id, ledger_mutations.committed_version/i.test(String(error?.message||error)))throw authError('資料版本不一致；請先重新載入後再操作',409);throw error;
 }
 logLedgerWrites('mutation',result,checked.operations.length);
 const row=result[1+checked.operations.length]?.results?.[0];if(!row)throw authError('增量儲存未完成，請重新載入後再試',409);
 return {id:row.account_id,name:row.account_name,version:row.version,updatedAt:row.updated_at,storageMode:'normalized',projectionVersion:state.projection_version??0,snapshotVersion:state.snapshot_version??0,syncStatus:'updating'};
}

export async function enqueueLedgerJobs({projectionQueue,snapshotQueue,accountId,version}){
 const jobs=[];if(projectionQueue)jobs.push(projectionQueue.send({kind:'projection',accountId,version}));if(snapshotQueue)jobs.push(snapshotQueue.send({kind:'snapshot',accountId,version}));return Promise.allSettled(jobs);
}

export async function processLedgerJob({db,objects,job}){
 if(!job||!['projection','snapshot'].includes(job.kind)||typeof job.accountId!=='string'||!Number.isInteger(job.version))throw Error('Invalid ledger job');
 const row=await db.prepare(`SELECT s.*,n.storage_mode,n.normalized_version,n.projection_version,n.snapshot_version FROM trade_account_snapshots s JOIN normalized_ledger_state n ON n.account_id=s.account_id WHERE s.account_id=? AND s.deleted_at IS NULL AND s.archived_at IS NULL`).bind(job.accountId).first();
 if(!row||row.storage_mode!=='normalized'||row.normalized_version<job.version)return {skipped:true};
 const target=row.normalized_version;if(job.kind==='projection'&&row.projection_version>=target)return {skipped:true};if(job.kind==='snapshot'&&row.snapshot_version>=target)return {skipped:true};
 const dataset=await readNormalizedDataset({db,objects,row}),serialized=JSON.stringify(completeTradeDataset(dataset)),hash=await sha256(serialized),now=new Date().toISOString();
 if(job.kind==='projection'){
  const home=buildHomeView(dataset),statement=homeViewStatement(db,{ownerId:row.owner_user_id,accountId:row.account_id,version:target,objectKey:row.object_key||'',sourceHash:hash,home});
  await db.batch([statement,db.prepare('UPDATE normalized_ledger_state SET projection_version=?,projection_pending=CASE WHEN normalized_version=? THEN 0 ELSE 1 END,last_error=NULL,updated_at=? WHERE account_id=? AND normalized_version>=?').bind(target,target,now,row.account_id,target)]);return {kind:'projection',version:target};
 }
 if(!objects)throw Error('R2 snapshots binding is unavailable');
 const objectKey=`snapshots/${row.owner_user_id}/${crypto.randomUUID()}.json`,sizeBytes=new TextEncoder().encode(serialized).length;
 if(await objects.put(objectKey,serialized,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:hash}})===null)throw Error('R2 snapshot write failed');
 const batch=await db.batch([db.prepare(`UPDATE trade_account_snapshots SET dataset_json='{}',object_key=?,size_bytes=? WHERE account_id=? AND version=? RETURNING account_id`).bind(objectKey,sizeBytes,row.account_id,target),db.prepare('UPDATE normalized_ledger_state SET snapshot_version=?,snapshot_pending=CASE WHEN normalized_version=? THEN 0 ELSE 1 END,last_error=NULL,updated_at=? WHERE account_id=? AND normalized_version>=?').bind(target,target,now,row.account_id,target),db.prepare('UPDATE ledger_home_views SET object_key=? WHERE account_id=? AND source_version=?').bind(objectKey,row.account_id,target)]);
 if(!batch[0].results?.length){await db.prepare('INSERT OR IGNORE INTO snapshot_object_gc(object_key,owner_user_id,size_bytes,created_at) VALUES(?,?,?,?)').bind(objectKey,row.owner_user_id,sizeBytes,now).run();return {skipped:true};}
 if(row.object_key&&row.object_key!==objectKey)await db.prepare('INSERT OR IGNORE INTO snapshot_object_gc(object_key,owner_user_id,size_bytes,created_at) VALUES(?,?,?,?)').bind(row.object_key,row.owner_user_id,Number(row.size_bytes)||0,now).run();
 return {kind:'snapshot',version:target,objectKey,sizeBytes};
}

export async function recoverPendingLedgerJobs({db,projectionQueue,snapshotQueue,limit=50}){
 const rows=(await db.prepare(`SELECT account_id,normalized_version,projection_pending,snapshot_pending FROM normalized_ledger_state WHERE storage_mode='normalized' AND (projection_pending=1 OR snapshot_pending=1) ORDER BY updated_at LIMIT ?`).bind(limit).all()).results;let sent=0;
 for(const row of rows){if(row.projection_pending&&projectionQueue){await projectionQueue.send({kind:'projection',accountId:row.account_id,version:row.normalized_version});sent++;}if(row.snapshot_pending&&snapshotQueue){await snapshotQueue.send({kind:'snapshot',accountId:row.account_id,version:row.normalized_version});sent++;}}
 await db.prepare("DELETE FROM ledger_change_log WHERE committed_at < datetime('now','-90 days')").run();await db.prepare("DELETE FROM ledger_mutations WHERE committed_at < datetime('now','-90 days')").run();return {examined:rows.length,sent};
}

export async function backfillNormalizedLedgers({db,objects,accountId=null,limit=3}){
 const rows=(await db.prepare(`SELECT s.* FROM trade_account_snapshots s LEFT JOIN normalized_ledger_state n ON n.account_id=s.account_id WHERE s.owner_user_id IS NOT NULL AND s.deleted_at IS NULL AND s.archived_at IS NULL AND (? IS NULL OR s.account_id=?) AND (n.account_id IS NULL OR n.normalized_version<>s.version OR n.last_error IS NOT NULL) ORDER BY s.updated_at LIMIT ?`).bind(accountId,accountId,limit).all()).results,results=[];
 for(const row of rows){
  const dataset=await loadSnapshotDataset(objects,row);if(!isDataset(dataset))throw authError(`帳本 ${row.account_id} 的快照格式無效`,503);
  const result=await replaceNormalizedDataset({db,accountId:row.account_id,dataset,version:row.version,storageMode:'shadow'}),rebuilt=await readNormalizedDataset({db,objects,row:{...row,storage_mode:'shadow'}});
  if(canonicalDurableJson(rebuilt)!==canonicalDurableJson(dataset)){const error='正規化影子資料與來源快照不一致';await db.prepare('UPDATE normalized_ledger_state SET last_error=?,updated_at=? WHERE account_id=?').bind(error,new Date().toISOString(),row.account_id).run();throw authError(`${row.account_id}：${error}`,503);}
  results.push({...result,verified:true});
 }
 return {examined:rows.length,results};
}

export async function activateNormalizedLedger({db,accountId,ownerId}){
 const now=new Date().toISOString(),row=await db.prepare(`UPDATE normalized_ledger_state SET storage_mode='normalized',updated_at=? WHERE account_id=? AND last_error IS NULL AND normalized_version=(SELECT version FROM trade_account_snapshots WHERE account_id=? AND owner_user_id=?) RETURNING account_id,normalized_version`).bind(now,accountId,accountId,ownerId).first();if(!row)throw authError('正規化資料尚未追上目前帳本版本或影子驗證尚未通過',409);return row;
}

export async function listLedgerChanges({db,accountId,ownerId,afterVersion}){
 const current=await db.prepare(`SELECT s.version,n.storage_mode,n.projection_version,n.snapshot_version FROM trade_account_snapshots s JOIN normalized_ledger_state n ON n.account_id=s.account_id WHERE s.account_id=? AND s.owner_user_id=? AND s.deleted_at IS NULL AND s.archived_at IS NULL`).bind(accountId,ownerId).first();if(!current)throw authError('無法存取此交易帳本',403);if(current.storage_mode!=='normalized')throw authError('此帳本尚未啟用增量讀取',428);if(afterVersion>=current.version)return {version:current.version,changes:[],sync:{projectionVersion:current.projection_version,snapshotVersion:current.snapshot_version}};
 const oldest=await db.prepare('SELECT MIN(version) version FROM ledger_change_log WHERE account_id=?').bind(accountId).first();if(!oldest?.version||afterVersion<oldest.version-1)throw authError('裝置版本已超出增量保留範圍，請重新載入完整帳本',410);
 const rows=(await db.prepare('SELECT version,mutation_id,operations_json,committed_at FROM ledger_change_log WHERE account_id=? AND version>? ORDER BY version LIMIT 500').bind(accountId,afterVersion).all()).results;
 return {version:current.version,changes:rows.map(row=>({version:row.version,mutationId:row.mutation_id,operations:JSON.parse(row.operations_json),committedAt:row.committed_at})),sync:{projectionVersion:current.projection_version,snapshotVersion:current.snapshot_version}};
}
