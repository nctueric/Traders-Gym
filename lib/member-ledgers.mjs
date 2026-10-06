import { authError, emptyDataset, json } from './auth-core.mjs';
import { bodyOf } from './access-applications.mjs';
const metadata=row=>({id:row.account_id,name:row.account_name,version:row.version,updatedAt:row.updated_at,deletedAt:row.deleted_at});
export function createMemberLedgers({db,authenticate,files}) {
 return async request=>{
  const user=await authenticate(request,{mutation:request.method!=='GET'});
  if(request.method==='GET'){
   const rows=await db.prepare('SELECT * FROM trade_account_snapshots WHERE owner_user_id=? ORDER BY deleted_at IS NOT NULL,updated_at DESC,account_id').bind(user.id).all();
   return json({accounts:rows.results.map(metadata)});
  }
  if(request.method!=='POST')throw authError('不支援的操作',405);
  const body=await bodyOf(request), time=new Date().toISOString();
  if(body.action==='create'){
   const name=String(body.name||'').trim(); if(!name||name.length>100)throw authError('帳本名稱請填寫 1–100 字',400);
   const id=crypto.randomUUID(),dataset=emptyDataset();dataset.profile.name=name;
   const serialized=JSON.stringify(dataset);
   // Store the local initial file first; an interrupted metadata write leaves no visible ledger.
   if(files)await files.save({accountId:id,accountName:name,dataset,baseVersion:0,saveMode:'initial'});
   const result=await db.batch([
    db.prepare(`INSERT INTO trade_account_snapshots(account_id,account_name,dataset_json,version,updated_at,owner_user_id,save_mode,size_bytes) SELECT ?,?,?,1,?,?,'initial',? WHERE EXISTS(SELECT 1 FROM auth_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND u.status='ACTIVE') RETURNING *`).bind(id,name,files?'{}':serialized,time,user.id,serialized.length,user.sessionId,user.id,time),
    db.prepare(`INSERT INTO member_preferences(user_id,active_account_id) SELECT ?,account_id FROM trade_account_snapshots WHERE account_id=? AND owner_user_id=? ON CONFLICT(user_id) DO UPDATE SET active_account_id=excluded.active_account_id`).bind(user.id,id,user.id)
   ]);
   if(!result[0].results.length)throw authError('登入已失效，帳本未建立',401);
   return json({account:metadata(result[0].results[0])},201);
  }
  if(!['rename','trash','restore','select'].includes(body.action))throw authError('帳本操作無效',400);
  const row=await db.prepare('SELECT * FROM trade_account_snapshots WHERE owner_user_id=? AND account_id=?').bind(user.id,String(body.id||'')).first();
  if(!row)throw authError('找不到此帳本',404);
  if(row.deleted_at && body.action!=='restore')throw authError('帳本已移至回收筒，請先還原',410);
  if(body.action==='select'){
   await db.prepare('INSERT INTO member_preferences(user_id,active_account_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET active_account_id=excluded.active_account_id').bind(user.id,row.account_id).run();
   return json({account:metadata(row)});
  }
  if(body.baseVersion!==row.version)throw authError('帳本已更新，請重新整理後操作',409);
  if(body.action==='restore'&&!row.deleted_at)throw authError('帳本已還原',409);
  const name=body.action==='rename'?String(body.name||'').trim():row.account_name;
  if(!name||name.length>100)throw authError('帳本名稱請填寫 1–100 字',400);
  const deleted=body.action==='trash'?time:null;
  const updated=await db.prepare(`UPDATE trade_account_snapshots SET account_name=?,deleted_at=?,version=version+1,updated_at=? WHERE account_id=? AND owner_user_id=? AND version=? AND EXISTS(SELECT 1 FROM auth_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? AND u.status='ACTIVE') RETURNING *`).bind(name,deleted,time,row.account_id,user.id,row.version,user.sessionId,time).first();
  if(!updated)throw authError('帳本狀態已變更，請重新整理',409);
  if(body.action==='trash')await db.prepare('UPDATE member_preferences SET active_account_id=NULL WHERE user_id=? AND active_account_id=?').bind(user.id,row.account_id).run();
  return json({account:metadata(updated)});
 };
}
