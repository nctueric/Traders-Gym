import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {sqliteAdapter} from '../server/sqlite-adapter.mjs';
import {previewRetention,pruneSnapshotHistory,drainSnapshotObjects,maintainSnapshotHistory} from '../lib/snapshot-retention.mjs';
const now='2026-10-06T16:00:00.000Z'; // Taipei Oct 7: keep Oct 1 through Oct 7.
function setup(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');
 const dir=new URL('../drizzle/',import.meta.url);for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(new URL(name,dir),'utf8'));
 for(const user of ['a','b']){
  sql.prepare("INSERT INTO app_users(id,email,name,status,created_at,last_login_at) VALUES(?,?,?,'ACTIVE',?,?)").run(user,user+'@example.test',user,now,now);
  sql.prepare("INSERT INTO trade_account_snapshots(account_id,account_name,dataset_json,version,updated_at,owner_user_id,object_key) VALUES(?,?,'{}',99,'2000-01-01',?,?)").run(user+'-ledger',user,user,user+'-live');
 }
 const insert=(version,date,{user='a',key=null,pinned=0}={})=>Number(sql.prepare("INSERT INTO snapshot_history(owner_user_id,account_id,account_name,version,created_at,dataset_json,object_key,size_bytes,pinned) VALUES(?,?,?, ?,?,'{}',?,10,?) RETURNING id").get(user,user+'-ledger',user,version,date,key,pinned).id);
 return {sql,db:sqliteAdapter(sql),insert,versions:()=>sql.prepare("SELECT version FROM snapshot_history WHERE owner_user_id='a' ORDER BY version").all().map(r=>r.version)};
}
test('Taipei day cutoff and same-day latest; live, unknown dates and other owners survive',async t=>{
 const h=setup(t);h.insert(0,'2026-09-01',{pinned:1});h.insert(1,'2026-09-30T15:59:59Z');h.insert(2,'2026-09-30T16:00:00Z');h.insert(3,'2026-10-05T16:00:00Z');h.insert(4,'2026-10-06T15:59:59Z');h.insert(5,'2026-10-06T16:00:00Z');h.insert(6,'2026-10-06T16:00:00Z');h.insert(99,'2000-01-01',{key:'a-live'});h.insert(7,'unknown');h.insert(1,'2000-01-01',{user:'b'});
 const preview=await previewRetention(h.db,{ownerId:'a',now});assert.equal(preview.removable,4);assert.equal(preview.retained,5);
 await pruneSnapshotHistory(h.db,{ownerId:'a',now});assert.deepEqual(h.versions(),[2,4,6,7,99]);assert.equal(h.sql.prepare("SELECT count(*) n FROM snapshot_history WHERE owner_user_id='b'").get().n,1);
});
test('eligibility rechecked after preview; transaction failure never leaves orphan queue work',async t=>{
 const h=setup(t),id=h.insert(1,'2000-01-01',{key:'old'});await previewRetention(h.db,{ownerId:'a',now});
 h.sql.exec("UPDATE trade_account_snapshots SET object_key='old' WHERE account_id='a-ledger'");assert.equal((await pruneSnapshotHistory(h.db,{ownerId:'a',ids:[id],now})).removed,0);
 h.sql.exec("UPDATE trade_account_snapshots SET object_key='a-live' WHERE account_id='a-ledger'; CREATE TRIGGER prevent_delete BEFORE DELETE ON snapshot_history BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 await assert.rejects(pruneSnapshotHistory(h.db,{ownerId:'a',now}));assert.equal(h.sql.prepare('SELECT count(*) n FROM snapshot_object_gc').get().n,0);assert.deepEqual(h.versions(),[1]);
});
test('R2 failure/crash leaves durable cleanup queue; retry protects references',async t=>{
 const h=setup(t);h.insert(1,'2000-01-01',{key:'old'});
 const result=await maintainSnapshotHistory(h.db,{delete:async()=>{throw new Error('R2 down');}},{ownerId:'a',now});assert.equal(result.removed,1);assert.equal(result.pendingObjects,1);
 h.sql.exec("UPDATE trade_account_snapshots SET object_key='old' WHERE account_id='b-ledger'");const deleted=[];
 await drainSnapshotObjects(h.db,{delete:async key=>deleted.push(key)},{ownerId:'a'});assert.deepEqual(deleted,[]);
 h.sql.exec("UPDATE trade_account_snapshots SET object_key='b-live' WHERE account_id='b-ledger'");await drainSnapshotObjects(h.db,{delete:async key=>deleted.push(key)},{ownerId:'a'});assert.deepEqual(deleted,['old']);assert.equal(h.sql.prepare('SELECT count(*) n FROM snapshot_object_gc').get().n,0);
});
test('deleted ledger current backup is protected and no domain data is mutated',async t=>{
 const h=setup(t);h.sql.exec("UPDATE trade_account_snapshots SET deleted_at='2026-10-01' WHERE account_id='a-ledger'");h.insert(98,'2000-01-01');h.insert(99,'2000-01-01');
 const before=h.sql.prepare('SELECT * FROM trade_account_snapshots').all();await maintainSnapshotHistory(h.db,null,{ownerId:'a',now});assert.deepEqual(h.versions(),[99]);assert.deepEqual(h.sql.prepare('SELECT * FROM trade_account_snapshots').all(),before);
});
