import {diffNormalizedDatasets} from './ledger-mutations.mjs';
import {normalizedReplacementStatements} from './normalized-ledger.mjs';
import {logLedgerWrites} from './storage-retry.mjs';
import {authError,sha256} from './auth-core.mjs';
import {buildHomeView,homeViewStatement} from './home-views.mjs';
// Both member saves and administrator recovery commit through the same CAS + home-view transaction.
export async function commitCloudLedger({db,objects,actor,targetId,accountId,checked,saveMode='manual',singleLedger=false,recovery=null,forceSnapshot=false}) {
 if(!objects)throw authError('雲端快照儲存尚未設定',503);
 if(!recovery&&!forceSnapshot){
   const existing=await db.prepare('SELECT account_id,account_name,version,updated_at,dataset_json,object_key FROM trade_account_snapshots WHERE account_id=? AND owner_user_id=? AND deleted_at IS NULL AND archived_at IS NULL').bind(accountId,targetId).first();
   if(existing?.version!==checked.baseVersion)throw authError('資料版本已變更；請先保留當頁修改再核對',409);
   let baseline=existing.dataset_json;
   if(existing.object_key){const source=await objects.get(existing.object_key);if(!source)throw authError('帳本快照暫時無法讀取',503);baseline=await source.text();}
   if(existing.account_name===checked.accountName&&!diffNormalizedDatasets(JSON.parse(baseline),checked.dataset).length)return {id:existing.account_id,name:existing.account_name,version:existing.version,updatedAt:existing.updated_at,unchanged:true};
 }
 const now=new Date().toISOString(),objectKey=`snapshots/${targetId}/${crypto.randomUUID()}.json`;
 const sourceHash=await sha256(checked.datasetJson),sizeBytes=new TextEncoder().encode(checked.datasetJson).length,home=buildHomeView(checked.dataset);
 if(await objects.put(objectKey,checked.datasetJson,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:sourceHash}})===null)throw authError('完整快照尚未儲存成功，請重試',503);
 const ownerCheck=recovery?` AND EXISTS(SELECT 1 FROM system_owner WHERE user_id=?) AND NOT EXISTS(SELECT 1 FROM system_owner WHERE user_id=?) AND EXISTS(SELECT 1 FROM member_weekly_backups WHERE user_id=? AND object_key=?)`:'';
 const policyCheck=singleLedger&&!actor.isOwner?` AND account_id=(SELECT account_id FROM member_ledger_bindings WHERE user_id=?)`:'';
 const save=db.prepare(`UPDATE trade_account_snapshots SET account_name=?,dataset_json='{}',version=version+1,updated_at=?,save_mode=?,size_bytes=?,object_key=? WHERE owner_user_id=? AND account_id=? AND deleted_at IS NULL AND archived_at IS NULL AND version=? AND EXISTS(SELECT 1 FROM auth_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND u.status='ACTIVE' AND s.expires_at>?)${ownerCheck}${policyCheck} RETURNING account_id,account_name,version,updated_at`).bind(checked.accountName,now,saveMode,sizeBytes,objectKey,targetId,accountId,checked.baseVersion,actor.sessionId,actor.id,now,...(recovery?[actor.id,targetId,targetId,recovery.object_key]:[]),...(singleLedger&&!actor.isOwner?[actor.id]:[]));
 const normalized=await db.prepare('SELECT storage_mode FROM normalized_ledger_state WHERE account_id=?').bind(accountId).first();
 const replacement=normalized?await normalizedReplacementStatements({db,accountId,dataset:checked.dataset,version:checked.baseVersion+1,storageMode:normalized.storage_mode}):null;
 const statements=[save,homeViewStatement(db,{ownerId:targetId,accountId,version:checked.baseVersion+1,objectKey,sourceHash,home})];
 // The existing mutation trigger aborts the whole transaction if the preceding CAS did not commit.
 statements.push(db.prepare(`INSERT INTO ledger_mutations(account_id,mutation_id,base_version,committed_version,operations_json,committed_at) SELECT ?,?,-1,?,'[]',? WHERE NOT EXISTS(SELECT 1 FROM trade_account_snapshots WHERE account_id=? AND object_key=?)`).bind(accountId,crypto.randomUUID(),checked.baseVersion+1,now,accountId,objectKey));
 if(replacement)statements.push(...replacement.statements);
 if(recovery)statements.push(db.prepare(`INSERT INTO ledger_recovery_events(id,actor_id,target_user_id,account_id,backup_week,source_version,before_version,after_version,result,created_at) SELECT ?,?,?,?,?,?,?,?,'SUCCESS',? WHERE EXISTS(SELECT 1 FROM trade_account_snapshots WHERE account_id=? AND owner_user_id=? AND object_key=?)`).bind(crypto.randomUUID(),actor.id,targetId,accountId,recovery.week_key,recovery.source_version,checked.baseVersion,checked.baseVersion+1,now,accountId,targetId,objectKey));
 let batch;try{batch=await db.batch(statements);}catch(e){await db.prepare('INSERT OR IGNORE INTO snapshot_object_gc VALUES(?,?,?,?)').bind(objectKey,targetId,sizeBytes,now).run();if(/LEDGER_VERSION_CONFLICT/.test(String(e?.message)))throw authError('資料版本或權限已變更；請先保留當頁修改再核對',409);throw e;}
 logLedgerWrites('complete-save',batch,replacement?.operations.length||0);
 const row=batch[0].results[0];
 if(!row){await db.prepare('INSERT OR IGNORE INTO snapshot_object_gc VALUES(?,?,?,?)').bind(objectKey,targetId,sizeBytes,now).run();throw authError('資料版本或權限已變更；請重新載入後再操作',409);}
 return {id:row.account_id,name:row.account_name,version:row.version,updatedAt:row.updated_at};
}
