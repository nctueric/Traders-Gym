import {authError,sha256} from './auth-core.mjs';
import {buildHomeView,homeViewStatement} from './home-views.mjs';
// Both member saves and administrator recovery commit through the same CAS + home-view transaction.
export async function commitCloudLedger({db,objects,actor,targetId,accountId,checked,saveMode='manual',singleLedger=false,recovery=null}) {
 if(!objects)throw authError('雲端快照儲存尚未設定',503);
 const now=new Date().toISOString(),objectKey=`snapshots/${targetId}/${crypto.randomUUID()}.json`;
 const sourceHash=await sha256(checked.datasetJson),sizeBytes=new TextEncoder().encode(checked.datasetJson).length,home=buildHomeView(checked.dataset);
 if(await objects.put(objectKey,checked.datasetJson,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:sourceHash}})===null)throw authError('完整快照尚未儲存成功，請重試',503);
 const ownerCheck=recovery?` AND EXISTS(SELECT 1 FROM system_owner WHERE user_id=?) AND NOT EXISTS(SELECT 1 FROM system_owner WHERE user_id=?) AND EXISTS(SELECT 1 FROM member_weekly_backups WHERE user_id=? AND object_key=?)`:'';
 const policyCheck=singleLedger&&!actor.isOwner?` AND account_id=(SELECT account_id FROM member_ledger_bindings WHERE user_id=?)`:'';
 const save=db.prepare(`UPDATE trade_account_snapshots SET account_name=?,dataset_json='{}',version=version+1,updated_at=?,save_mode=?,size_bytes=?,object_key=? WHERE owner_user_id=? AND account_id=? AND deleted_at IS NULL AND archived_at IS NULL AND version=? AND EXISTS(SELECT 1 FROM auth_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND u.status='ACTIVE' AND s.expires_at>?)${ownerCheck}${policyCheck} RETURNING account_id,account_name,version,updated_at`).bind(checked.accountName,now,saveMode,sizeBytes,objectKey,targetId,accountId,checked.baseVersion,actor.sessionId,actor.id,now,...(recovery?[actor.id,targetId,targetId,recovery.object_key]:[]),...(singleLedger&&!actor.isOwner?[actor.id]:[]));
 const statements=[save,homeViewStatement(db,{ownerId:targetId,accountId,version:checked.baseVersion+1,objectKey,sourceHash,home})];
 if(recovery)statements.push(db.prepare(`INSERT INTO ledger_recovery_events(id,actor_id,target_user_id,account_id,backup_week,source_version,before_version,after_version,result,created_at) SELECT ?,?,?,?,?,?,?,?,'SUCCESS',? WHERE EXISTS(SELECT 1 FROM trade_account_snapshots WHERE account_id=? AND owner_user_id=? AND object_key=?)`).bind(crypto.randomUUID(),actor.id,targetId,accountId,recovery.week_key,recovery.source_version,checked.baseVersion,checked.baseVersion+1,now,accountId,targetId,objectKey));
 let batch;try{batch=await db.batch(statements);}catch(e){await db.prepare('INSERT OR IGNORE INTO snapshot_object_gc VALUES(?,?,?,?)').bind(objectKey,targetId,sizeBytes,now).run();throw e;}
 const row=batch[0].results[0];
 if(!row){await db.prepare('INSERT OR IGNORE INTO snapshot_object_gc VALUES(?,?,?,?)').bind(objectKey,targetId,sizeBytes,now).run();throw authError('資料版本或權限已變更；請重新載入後再操作',409);}
 return {id:row.account_id,name:row.account_name,version:row.version,updatedAt:row.updated_at};
}
