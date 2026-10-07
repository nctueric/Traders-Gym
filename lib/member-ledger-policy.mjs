import {emptyDataset,authError} from './auth-core.mjs';
// The binding never changes when a ledger is renamed, imported or restored.
export async function ensureMemberLedger(db,user) {
 if(user.isOwner)return null;
 const existing=await db.prepare('SELECT account_id FROM member_ledger_bindings WHERE user_id=?').bind(user.id).first();
 if(existing){await db.prepare('UPDATE trade_account_snapshots SET archived_at=? WHERE owner_user_id=? AND account_id<>? AND archived_at IS NULL').bind(new Date().toISOString(),user.id,existing.account_id).run();return existing.account_id;}
 const dataset=JSON.stringify(emptyDataset()),now=new Date().toISOString();
 await db.batch([
  db.prepare(`INSERT INTO trade_account_snapshots(account_id,account_name,dataset_json,version,updated_at,owner_user_id,save_mode,size_bytes)
   SELECT ?,'我的交易帳本',?,1,?,?,'initial',? WHERE EXISTS(SELECT 1 FROM app_users WHERE id=?) AND NOT EXISTS(SELECT 1 FROM trade_account_snapshots WHERE owner_user_id=? AND deleted_at IS NULL AND archived_at IS NULL) ON CONFLICT(account_id) DO NOTHING`).bind(`member_${crypto.randomUUID()}`,dataset,now,user.id,new TextEncoder().encode(dataset).length,user.id,user.id),
  db.prepare(`INSERT OR IGNORE INTO member_ledger_bindings(user_id,account_id)
   SELECT ?,account_id FROM trade_account_snapshots WHERE owner_user_id=? AND deleted_at IS NULL AND archived_at IS NULL
   ORDER BY account_id=COALESCE((SELECT active_account_id FROM member_preferences WHERE user_id=?),'') DESC,updated_at DESC,account_id LIMIT 1`).bind(user.id,user.id,user.id),
  db.prepare(`UPDATE trade_account_snapshots SET archived_at=? WHERE owner_user_id=? AND account_id<>(SELECT account_id FROM member_ledger_bindings WHERE user_id=?) AND archived_at IS NULL`).bind(now,user.id,user.id),
  db.prepare(`INSERT INTO member_preferences(user_id,active_account_id) SELECT user_id,account_id FROM member_ledger_bindings WHERE user_id=? ON CONFLICT(user_id) DO UPDATE SET active_account_id=excluded.active_account_id`).bind(user.id),
 ]);
 const row=await db.prepare('SELECT account_id FROM member_ledger_bindings WHERE user_id=?').bind(user.id).first();
 if(!row)throw authError('正式帳本尚未準備完成',503);
 return row.account_id;
}
