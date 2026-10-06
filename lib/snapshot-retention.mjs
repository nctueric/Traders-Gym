// Taipei calendar days, today plus six previous days. Unknown dates stay intact.
// Pinned upgrade baselines follow the new policy once explicitly activated.
export const retentionEligible = `julianday(created_at) IS NOT NULL AND (
 date(created_at,'+8 hours') < date(?,'+8 hours','-6 days') OR EXISTS (
  SELECT 1 FROM snapshot_history newer WHERE newer.owner_user_id=snapshot_history.owner_user_id
  AND newer.account_id=snapshot_history.account_id
  AND date(newer.created_at,'+8 hours')=date(snapshot_history.created_at,'+8 hours')
  AND newer.version>snapshot_history.version))
 AND NOT EXISTS(SELECT 1 FROM trade_account_snapshots live WHERE
 (live.account_id=snapshot_history.account_id AND live.version=snapshot_history.version)
 OR (snapshot_history.object_key IS NOT NULL AND live.object_key=snapshot_history.object_key))
 AND EXISTS(SELECT 1 FROM trade_account_snapshots live WHERE live.account_id=snapshot_history.account_id)
`;
const scopeClause=({ownerId,accountId})=>(ownerId?' AND owner_user_id=?':'')+(accountId?' AND account_id=?':'');
const scopeArgs=({ownerId,accountId})=>[...(ownerId?[ownerId]:[]),...(accountId?[accountId]:[])];

export async function previewRetention(db,{ownerId,accountId,now=new Date().toISOString()}={}){
 const scope={ownerId,accountId},where=retentionEligible+scopeClause(scope),args=[now,...scopeArgs(scope)];
 const summary=await db.prepare(`SELECT count(*) AS count,COALESCE(sum(size_bytes),0) AS bytes FROM snapshot_history WHERE ${where}`).bind(...args).first();
 const total=await db.prepare(`SELECT count(*) AS count FROM snapshot_history WHERE 1=1 ${scopeClause(scope)}`).bind(...scopeArgs(scope)).first();
 const items=await db.prepare(`SELECT id,account_id AS accountId,account_name AS accountName,version,created_at AS createdAt,size_bytes AS sizeBytes FROM snapshot_history WHERE ${where} ORDER BY id LIMIT 50`).bind(...args).all();
 return {items:items.results,bytes:summary.bytes,removable:summary.count,retained:total.count-summary.count,batchLimit:50};
}

// Queue insertion and metadata removal are atomic; an R2 outage/process crash
// leaves durable retry work, never an untracked orphan or a lost live snapshot.
export async function pruneSnapshotHistory(db,{ownerId,accountId,ids,now=new Date().toISOString(),limit=100}={}){
 const where=retentionEligible+scopeClause({ownerId,accountId})+(ids?' AND id IN ('+ids.map(()=>'?').join(',')+')':'');
 const args=[now,...scopeArgs({ownerId,accountId}),...(ids||[]),Math.min(100,Math.max(1,limit))];
 const candidates=`SELECT id FROM snapshot_history WHERE ${where} ORDER BY id LIMIT ?`;
 const results=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO snapshot_object_gc(object_key,owner_user_id,size_bytes,created_at)
   SELECT object_key,owner_user_id,size_bytes,? FROM snapshot_history WHERE id IN (${candidates}) AND object_key IS NOT NULL`).bind(now,...args),
  db.prepare(`DELETE FROM snapshot_history WHERE id IN (${candidates}) RETURNING id,size_bytes`).bind(...args),
 ]);
 return {removed:results[1].results.length,bytes:results[1].results.reduce((sum,row)=>sum+row.size_bytes,0)};
}
export async function drainSnapshotObjects(db,objects,{ownerId,limit=100}={}){
 const rows=await db.prepare(`SELECT * FROM snapshot_object_gc ${ownerId?'WHERE owner_user_id=?':''} ORDER BY created_at,object_key LIMIT ?`).bind(...(ownerId?[ownerId]:[]),limit).all();
 let reclaimedBytes=0;
 for(const row of rows.results){
  const ref=await db.prepare('SELECT object_key FROM trade_account_snapshots WHERE object_key=? UNION ALL SELECT object_key FROM snapshot_history WHERE object_key=? LIMIT 1').bind(row.object_key,row.object_key).first();
  const defer=()=>db.prepare('UPDATE snapshot_object_gc SET created_at=? WHERE object_key=?').bind(new Date().toISOString(),row.object_key).run();
  if(ref||!objects){await defer();continue;}
  try{await objects.delete(row.object_key);}catch{await defer();continue;}
  await db.prepare('DELETE FROM snapshot_object_gc WHERE object_key=?').bind(row.object_key).run();reclaimedBytes+=row.size_bytes;
 }
 const pending=await db.prepare(`SELECT count(*) AS count FROM snapshot_object_gc ${ownerId?'WHERE owner_user_id=?':''}`).bind(...(ownerId?[ownerId]:[])).first();
 return {reclaimedBytes,pendingObjects:pending.count};
}
export async function maintainSnapshotHistory(db,objects,options={}){
 const pruned=await pruneSnapshotHistory(db,options),collected=await drainSnapshotObjects(db,objects,options);
 return {...pruned,...collected};
}
