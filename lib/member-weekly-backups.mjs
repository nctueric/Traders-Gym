import {authError,json,sha256} from './auth-core.mjs';
import {readHistoryDataset} from './snapshot-history.mjs';
import {validateTradeRecordPayload} from './trade-record-store.mjs';
import {buildHomeView} from './home-views.mjs';
import {commitCloudLedger} from './cloud-ledger-save.mjs';

async function bounded(work,ms){let timer;try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(authError('備份讀寫逾時，等待重試',503)),ms);})]);}finally{clearTimeout(timer);}}
const ny=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
// Friday at 16:00 regardless of market holidays. Sunday catch-up is still the same NY week.
export function weeklyBackupDue(now=new Date()) {
 const parts=Object.fromEntries(ny.formatToParts(now).map(p=>[p.type,p.value]));
 const local=new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`),day=local.getUTCDay();
 local.setUTCDate(local.getUTCDate()+5-(day===0?7:day));
 const weekKey=local.toISOString().slice(0,10);
 let scheduledAt;
 for(const hour of [20,21]){const date=new Date(`${weekKey}T${hour}:00:00Z`);if(ny.formatToParts(date).find(p=>p.type==='hour').value==='16')scheduledAt=date.toISOString();}
 return scheduledAt&&now.toISOString()>=scheduledAt?{weekKey,scheduledAt}:null;
}
export async function runWeeklyMemberBackups(db,objects,{now=new Date(),limit=5,ioTimeout=10000}={}) {
 if(!objects)throw authError('每週備份缺少 R2 綁定',503);
 const time=now.toISOString(),due=weeklyBackupDue(now);
 if(due)await db.batch([
  db.prepare(`INSERT OR IGNORE INTO snapshot_object_gc(object_key,owner_user_id,size_bytes,created_at) SELECT backup_object_key,user_id,0,? FROM member_backup_jobs WHERE week_key<? AND state IN ('PENDING','FAILED') AND backup_object_key IS NOT NULL`).bind(time,due.weekKey),
  db.prepare(`UPDATE member_backup_jobs SET state='SUPERSEDED',lease_token=NULL WHERE week_key<? AND state IN ('PENDING','FAILED')`).bind(due.weekKey),
  db.prepare(`INSERT OR IGNORE INTO member_backup_jobs(id,user_id,account_id,week_key,source_version,source_object_key,dataset_json,scheduled_at,captured_at,state)
   SELECT b.user_id||':'||?,b.user_id,a.account_id,?,a.version,a.object_key,a.dataset_json,?,?,'PENDING' FROM member_ledger_bindings b JOIN trade_account_snapshots a ON a.account_id=b.account_id AND a.owner_user_id=b.user_id JOIN app_users u ON u.id=b.user_id WHERE a.deleted_at IS NULL AND a.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM system_owner WHERE user_id=b.user_id)`).bind(due.weekKey,due.weekKey,due.scheduledAt,time),
 ]);
 const rows=await db.prepare(`SELECT * FROM member_backup_jobs WHERE state IN ('PENDING','FAILED','RUNNING') AND (lease_until IS NULL OR lease_until<=?) ORDER BY attempts,captured_at,id LIMIT ?`).bind(time,limit).all();
 let completed=0,failed=0;
 for(const candidate of rows.results){
  const token=crypto.randomUUID(),leaseUntil=new Date(now.getTime()+300000).toISOString();
  const job=await db.prepare(`UPDATE member_backup_jobs SET state='RUNNING',attempts=attempts+1,lease_until=?,lease_token=? WHERE id=? AND state IN ('PENDING','FAILED','RUNNING') AND (lease_until IS NULL OR lease_until<=?) RETURNING *`).bind(leaseUntil,token,candidate.id,time).first();
  if(!job)continue;
  const key=`weekly-backups/${job.user_id}/${job.week_key}/${token}.json`;
  try {
   // Persist the candidate object reference before uploading, so crashes stay recoverable.
   const claimed=await db.prepare(`UPDATE member_backup_jobs SET backup_object_key=? WHERE id=? AND lease_token=? RETURNING id`).bind(key,job.id,token).first();
   if(!claimed)continue;
   if(candidate.backup_object_key)await db.prepare('INSERT OR IGNORE INTO snapshot_object_gc VALUES(?,?,?,?)').bind(candidate.backup_object_key,job.user_id,0,time).run();
   const serialized=await bounded(()=>readHistoryDataset({dataset_json:job.dataset_json,object_key:job.source_object_key},objects),ioTimeout);
   const checked=validateTradeRecordPayload({accountId:job.account_id,accountName:'備份',dataset:JSON.parse(serialized),baseVersion:job.source_version},{maxBytes:50_000_000});
   if(!checked.ok)throw authError(checked.error,503);
   const hash=await sha256(serialized),size=new TextEncoder().encode(serialized).length;
   if(await bounded(()=>objects.put(key,serialized,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:hash}}),ioTimeout)===null)throw authError('備份快照尚未儲存成功',503);
   // Read back the independent copy before replacing the last successful backup.
   await bounded(()=>readHistoryDataset({object_key:key},objects),ioTimeout);
   const done=new Date().toISOString();
   await db.batch([
    db.prepare(`INSERT OR IGNORE INTO snapshot_object_gc(object_key,owner_user_id,size_bytes,created_at) SELECT object_key,user_id,size_bytes,? FROM member_weekly_backups WHERE user_id=? AND week_key<=? AND EXISTS(SELECT 1 FROM member_backup_jobs WHERE id=? AND lease_token=?)`).bind(done,job.user_id,job.week_key,job.id,token),
    db.prepare(`INSERT INTO member_weekly_backups(user_id,account_id,week_key,source_version,source_hash,object_key,size_bytes,scheduled_at,captured_at,completed_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM member_backup_jobs WHERE id=? AND lease_token=? AND state='RUNNING') ON CONFLICT(user_id) DO UPDATE SET account_id=excluded.account_id,week_key=excluded.week_key,source_version=excluded.source_version,source_hash=excluded.source_hash,object_key=excluded.object_key,size_bytes=excluded.size_bytes,scheduled_at=excluded.scheduled_at,captured_at=excluded.captured_at,completed_at=excluded.completed_at WHERE member_weekly_backups.week_key<=excluded.week_key`).bind(job.user_id,job.account_id,job.week_key,job.source_version,hash,key,size,job.scheduled_at,job.captured_at,done,job.id,token),
    db.prepare(`UPDATE member_backup_jobs SET state=CASE WHEN EXISTS(SELECT 1 FROM member_weekly_backups WHERE object_key=?) THEN 'SUCCESS' ELSE 'SUPERSEDED' END,completed_at=?,lease_until=NULL,error=NULL,dataset_json='{}' WHERE id=? AND lease_token=?`).bind(key,done,job.id,token),
    db.prepare(`INSERT OR IGNORE INTO snapshot_object_gc VALUES(?,?,?,?)`).bind(key,job.user_id,size,done),
   ]);
   completed++;
  }catch(e){
   await db.prepare(`UPDATE member_backup_jobs SET state='FAILED',error=?,lease_until=?,backup_object_key=?,lease_token=NULL WHERE id=? AND lease_token=?`).bind(e.status?e.message:'備份服務失敗，等待重試',new Date(now.getTime()+60000).toISOString(),key,job.id,token).run();failed++;
  }
 }
 return {completed,failed};
}
export function createMemberBackupsApi({db,objects,authenticate,weeklyBackupsEnabled=false}) {
 return async (request,user)=>{
  if(!user.isOwner)throw authError('只有管理員可以使用此操作',403);
  const url=new URL(request.url),target=url.searchParams.get('userId');
  if(request.method==='GET'&&['archives','archive-download'].includes(url.searchParams.get('action'))){
   if(!target)throw authError('請選擇會員',400);
   if(url.searchParams.get('action')==='archives'){const rows=await db.prepare('SELECT account_id,account_name,version,archived_at FROM trade_account_snapshots WHERE owner_user_id=? AND archived_at IS NOT NULL ORDER BY updated_at DESC').bind(target).all();return json({items:rows.results});}
   const row=await db.prepare('SELECT * FROM trade_account_snapshots WHERE owner_user_id=? AND account_id=? AND archived_at IS NOT NULL').bind(target,url.searchParams.get('accountId')).first();if(!row)throw authError('找不到封存帳本',404);
   return new Response(await readHistoryDataset(row,objects),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  if(request.method==='GET'&&!target){
   const rows=await db.prepare(`SELECT u.id userId,u.email,u.name,b.account_id accountId,a.account_name accountName,a.version currentVersion,w.week_key weekKey,w.source_version sourceVersion,w.captured_at capturedAt,w.completed_at completedAt,j.state,j.error,j.scheduled_at scheduledAt,j.attempts FROM app_users u LEFT JOIN member_ledger_bindings b ON b.user_id=u.id LEFT JOIN trade_account_snapshots a ON a.account_id=b.account_id LEFT JOIN member_weekly_backups w ON w.user_id=u.id LEFT JOIN member_backup_jobs j ON j.id=(SELECT id FROM member_backup_jobs WHERE user_id=u.id ORDER BY week_key DESC LIMIT 1) WHERE NOT EXISTS(SELECT 1 FROM system_owner WHERE user_id=u.id) ORDER BY u.email LIMIT 501`).all();
   return json({enabled:weeklyBackupsEnabled,items:rows.results.slice(0,500),truncated:rows.results.length>500});
  }
  if(request.method==='GET'&&url.searchParams.get('action')==='events'){
   const rows=await db.prepare('SELECT * FROM ledger_recovery_events WHERE target_user_id=? ORDER BY created_at DESC LIMIT 50').bind(target).all();return json({events:rows.results});
  }
  const body=request.method==='POST'?await request.json():null,userId=target||body?.userId;
  if(!userId)throw authError('請選擇會員',400);
  const row=await db.prepare(`SELECT w.*,a.account_name,a.version current_version,u.email FROM member_weekly_backups w JOIN member_ledger_bindings b ON b.user_id=w.user_id AND b.account_id=w.account_id JOIN trade_account_snapshots a ON a.account_id=w.account_id AND a.owner_user_id=w.user_id JOIN app_users u ON u.id=w.user_id WHERE w.user_id=? AND a.deleted_at IS NULL AND a.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM system_owner WHERE user_id=w.user_id)`).bind(userId).first();
  if(!row)throw authError('尚無可還原的每週備份',404);
  let serialized;try{serialized=await readHistoryDataset(row,objects);}catch(e){if(request.method==='POST')await db.prepare(`INSERT INTO ledger_recovery_events VALUES(?,?,?,?,?,?,?,NULL,'FAILED',?)`).bind(crypto.randomUUID(),user.id,row.user_id,row.account_id,row.week_key,row.source_version,row.current_version,new Date().toISOString()).run();throw e;}
  if(await sha256(serialized)!==row.source_hash)throw authError('備份校驗碼不一致，已停止還原',503);
  const dataset=JSON.parse(serialized);
  if(request.method==='GET')return json({userId,email:row.email,accountId:row.account_id,accountName:row.account_name,currentVersion:row.current_version,sourceVersion:row.source_version,weekKey:row.week_key,completedAt:row.completed_at,backupId:row.object_key,home:buildHomeView(dataset),cashActivityCount:(dataset.cashActivities||[]).length});
  if(request.method!=='POST'||body.action!=='restore')throw authError('不支援的操作',405);
  try{
   if(body.backupId!==row.object_key||body.baseVersion!==row.current_version)throw authError('帳本或備份已更新，請重新預覽',409);
   const checked=validateTradeRecordPayload({accountId:row.account_id,accountName:row.account_name,dataset,baseVersion:body.baseVersion},{maxBytes:50_000_000});
   if(!checked.ok)throw authError(checked.error,400);
   const actor=await authenticate(request,{owner:true,mutation:true});
   const account=await commitCloudLedger({db,objects,actor,targetId:row.user_id,accountId:row.account_id,checked,saveMode:'restore',recovery:row});
   return json({account});
  }catch(e){
   await db.prepare(`INSERT INTO ledger_recovery_events VALUES(?,?,?,?,?,?,?,NULL,?,?)`).bind(crypto.randomUUID(),user.id,row.user_id,row.account_id,row.week_key,row.source_version,row.current_version,e.status===409?'CONFLICT':'FAILED',new Date().toISOString()).run();throw e;
  }
 };
}
