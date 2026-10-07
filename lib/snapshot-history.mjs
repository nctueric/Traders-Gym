import {previewRetention,pruneSnapshotHistory,drainSnapshotObjects} from "./snapshot-retention.mjs";
import { authError, json, sha256 } from './auth-core.mjs';
import { validateTradeRecordPayload } from './trade-record-store.mjs';

// Calendar-day representatives use the trader's Taipei timezone. Unknown dates are retained.
const eligible = `owner_user_id = ? AND pinned = 0
 AND julianday(created_at) < julianday(?, '-7 days')
 AND (julianday(created_at) < julianday(?, '-30 days') OR EXISTS (
   SELECT 1 FROM snapshot_history newer WHERE newer.owner_user_id=snapshot_history.owner_user_id
   AND newer.account_id=snapshot_history.account_id
   AND date(newer.created_at,'+8 hours')=date(snapshot_history.created_at,'+8 hours')
   AND (newer.created_at>snapshot_history.created_at OR (newer.created_at=snapshot_history.created_at AND newer.id>snapshot_history.id))))
 AND NOT EXISTS(SELECT 1 FROM trade_account_snapshots live WHERE
   (live.account_id=snapshot_history.account_id AND live.version=snapshot_history.version)
   OR (snapshot_history.object_key IS NOT NULL AND live.object_key=snapshot_history.object_key))`;

export async function readHistoryDataset(row, objects) {
  let serialized = row.dataset_json;
  if (row.object_key) {
    if (!objects) throw authError('完整快照儲存尚未設定',503);
    const object = await objects.get(row.object_key);
    if (!object) throw authError('找不到此版本的完整快照',503);
    serialized = await object.text();
    if (object.customMetadata?.sha256 !== await sha256(serialized)) throw authError('此版本未通過完整性校驗，已停止還原',503);
  }
  return serialized;
}

export function createHistoryApi({ db, objects, authenticate, restore, retentionEnabled = false }) {
  return async function history(request, user) {
    if (!user.isOwner) throw authError('只有系統擁有者可以管理版本',403);
    const url = new URL(request.url), action = url.searchParams.get('action') || 'list';
    if (request.method === 'GET' && action === 'list') {
      const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
      const result = await db.prepare(`SELECT id,account_id AS accountId,account_name AS accountName,version,created_at AS createdAt,size_bytes AS sizeBytes,pinned,
        EXISTS(SELECT 1 FROM trade_account_snapshots s WHERE s.account_id=h.account_id AND s.version=h.version) AS isCurrent
        FROM snapshot_history h WHERE owner_user_id=? AND id<? ORDER BY id DESC LIMIT 51`).bind(user.id,before).all();
      const items=result.results.slice(0,50);
      return json({retentionEnabled,items,nextBefore:result.results.length>50 ? items.at(-1).id : null});
    }
    if (request.method === 'GET' && (action === 'retention-preview' || (retentionEnabled && action === 'preview'))) return json(await previewRetention(db,{ownerId:user.id}));
    if (request.method === 'GET' && action === 'preview') {
      const now = new Date().toISOString();
      const result = await db.prepare(`SELECT id,version,created_at AS createdAt,size_bytes AS sizeBytes FROM snapshot_history WHERE ${eligible} ORDER BY created_at,id LIMIT 50`).bind(user.id,now,now).all();
      return json({items:result.results,bytes:result.results.reduce((n,r)=>n+r.sizeBytes,0),batchLimit:50});
    }
    if (request.method === 'GET' && action === 'download') {
      const row=await db.prepare('SELECT * FROM snapshot_history WHERE id=? AND owner_user_id=?').bind(Number(url.searchParams.get('id')) || 0,user.id).first();
      if (!row) throw authError('找不到此版本',404);
      return new Response(await readHistoryDataset(row,objects),{headers:{'Content-Type':'application/json','Content-Disposition':`attachment; filename="trade-review-v${row.version}.json"`,'Cache-Control':'no-store'}});
    }
    if(request.method !== 'POST') throw authError('不支援的版本操作',405);
    const body=await request.json();
    if(action === 'restore') {
      const row=await db.prepare('SELECT * FROM snapshot_history WHERE id=? AND owner_user_id=?').bind(body.id || 0,user.id).first();
      if(!row) throw authError('找不到此版本',404);
      const dataset=JSON.parse(await readHistoryDataset(row,objects));
      const checked=validateTradeRecordPayload({accountId:row.account_id,accountName:row.account_name,dataset,baseVersion:body.baseVersion},{maxBytes:50_000_000});
      if(!checked.ok) throw authError(checked.error,400);
      // Restore uses the ordinary version-checked save path and creates a fresh R2 key.
      const result=await restore(new Request(new URL('/api/trade-records',request.url),{method:'PUT',headers:request.headers,body:JSON.stringify({accountId:row.account_id,accountName:row.account_name,dataset,baseVersion:body.baseVersion,saveMode:'manual'})}));
      return result;
    }
    if(action !== 'cleanup') throw authError('不支援的版本操作',400);
    if(!Array.isArray(body.ids) || !body.ids.length || body.ids.length>50 || body.ids.some(id=>!Number.isSafeInteger(id)||id<1)) throw authError('請先預覽並選定最多 50 個版本',400);
    await authenticate(request);
    if(retentionEnabled){
      const removed=await pruneSnapshotHistory(db,{ownerId:user.id,ids:body.ids});
      const objectsResult=await drainSnapshotObjects(db,objects,{ownerId:user.id});
      return json({...removed,...objectsResult,message:objectsResult.pendingObjects?'版本已整理，部分檔案待背景重試':'本批清理完成'});
    }
    const now=new Date().toISOString();
    // Eligibility and current references are rechecked in the DELETE itself.
    const removed=await db.prepare(`DELETE FROM snapshot_history WHERE id IN (${body.ids.map(()=>'?').join(',')}) AND ${eligible} RETURNING *`).bind(...body.ids,user.id,now,now).all();
    let reclaimedBytes=0; const pendingObjectKeys=[];
    // Keep failed deletions visible and retryable on the next preview.
    const retain = async row => {
      pendingObjectKeys.push(row.object_key);
      await db.prepare(`INSERT OR IGNORE INTO snapshot_history(id,owner_user_id,account_id,account_name,version,created_at,dataset_json,object_key,size_bytes,pinned)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(row.id,row.owner_user_id,row.account_id,row.account_name,row.version,row.created_at,row.dataset_json,row.object_key,row.size_bytes,row.pinned).run();
    };
    for(const row of removed.results) {
      if(!row.object_key) { reclaimedBytes+=row.size_bytes; continue; }
      const ref=await db.prepare(`SELECT object_key FROM trade_account_snapshots WHERE object_key=? UNION ALL SELECT object_key FROM snapshot_history WHERE object_key=? UNION ALL SELECT object_key FROM member_weekly_backups WHERE object_key=? UNION ALL SELECT source_object_key FROM member_backup_jobs WHERE source_object_key=? AND state IN ('PENDING','FAILED','RUNNING') UNION ALL SELECT backup_object_key FROM member_backup_jobs WHERE backup_object_key=? AND state IN ('PENDING','FAILED','RUNNING') LIMIT 1`).bind(row.object_key,row.object_key,row.object_key,row.object_key,row.object_key).first();
      if(ref || !objects) { await retain(row); continue; }
      try { await objects.delete(row.object_key); reclaimedBytes+=row.size_bytes; }
      catch { await retain(row); }
    }
    return json({removed:removed.results.length-pendingObjectKeys.length,reclaimedBytes,pendingObjects:pendingObjectKeys.length,message:pendingObjectKeys.length ? '部分檔案未刪除，已保留；需檢查儲存服務' : '本批清理完成'});
  };
}
