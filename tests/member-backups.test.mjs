import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {sqliteAdapter} from '../server/sqlite-adapter.mjs';
import {memoryObjects} from './cloud-objects.mjs';
import {createAccountApi} from '../lib/account-api.mjs';
import {signIn,OWNER_EMAIL,COOKIE_NAME,emptyDataset,sha256} from '../lib/auth-core.mjs';
import {weeklyBackupDue,runWeeklyMemberBackups} from '../lib/member-weekly-backups.mjs';
import {drainSnapshotObjects,pruneSnapshotHistory} from '../lib/snapshot-retention.mjs';
import {loadWorkspaceBootstrap} from '../lib/workspace-bootstrap.mjs';
async function harness(t,{single=true}={}){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');const dir=new URL('../drizzle/',import.meta.url);for(const n of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(n,dir),'utf8'));
 const db=sqliteAdapter(sqlite),objects=memoryObjects();
 const admin=await signIn(db,{sub:'backup-owner',email:OWNER_EMAIL,name:'Owner',email_verified:true}),member=await signIn(db,{sub:'backup-member',email:'backup-fixture@example.test',name:'Member',email_verified:true},{openGoogleLogin:true});
 const api=createAccountApi({db,objects,clientId:'fixture',singleLedger:single,weeklyBackupsEnabled:true});
 const req=(session,path,body,method=body?'POST':'GET')=>new Request('https://test.example'+path,{method,headers:{Cookie:`${COOKIE_NAME}=${session.token}`,Origin:'https://test.example','x-workspace-session':session.sessionId,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const call=async(session,path,body,method)=>{const response=await api.handle(req(session,path,body,method));return {status:response.status,data:await response.json()};};
 const records=()=>call(member,'/api/trade-records');
 const save=(body)=>call(member,'/api/trade-records',body,'PUT');
 return {sqlite,db,objects,admin,member,api,req,call,records,save};
}
const friday='2026-10-09T20:00:00.000Z',nextFriday='2026-10-16T20:00:00.000Z';
function cash(amount){const d=emptyDataset();d.cashActivities=[{id:'deposit',type:'DEPOSIT',currency:'USD',amount,timestamp:'2026-10-01T00:00:00Z'}];return d;}
async function seed(h,amount=1000){const r=await h.records();assert.equal(r.status,200);const saved=await h.save({accountId:r.data.account.id,accountName:'正式帳本',baseVersion:r.data.account.version,dataset:cash(amount)});assert.equal(saved.status,200,JSON.stringify(saved.data));return saved.data.account;}
async function backup(h,now=friday){const result=await runWeeklyMemberBackups(h.db,h.objects,{now:new Date(now)});assert.equal(result.failed,0);return h.sqlite.prepare('SELECT * FROM member_weekly_backups').get();}

test('weekly deadline follows NY DST, midnight boundaries, holidays and early-close Fridays',()=>{
 assert.equal(weeklyBackupDue(new Date('2026-10-09T19:59:59Z')),null);
 assert.equal(weeklyBackupDue(new Date(friday)).scheduledAt,friday);
 assert.equal(weeklyBackupDue(new Date('2026-10-10T04:00:00Z')).weekKey,'2026-10-09');
 assert.equal(weeklyBackupDue(new Date('2026-11-06T20:59:00Z')),null);
 assert.equal(weeklyBackupDue(new Date('2026-11-06T21:00:00Z')).scheduledAt,'2026-11-06T21:00:00.000Z');
 assert.equal(weeklyBackupDue(new Date('2026-11-27T18:00:00Z')),null); // early close still waits for 16:00
 assert.equal(weeklyBackupDue(new Date('2026-12-25T21:00:00Z')).weekKey,'2026-12-25'); // holiday still runs
 assert.equal(weeklyBackupDue(new Date('2027-01-01T21:00:00Z')).weekKey,'2027-01-01');
 assert.equal(weeklyBackupDue(new Date('2026-03-13T20:00:00Z')).scheduledAt,'2026-03-13T20:00:00.000Z');
 assert.equal(weeklyBackupDue(new Date('2026-10-07T20:00:00Z')),null);
});
test('members have one ledger, owners retain multiple, member APIs never reveal backup state',async t=>{
 const h=await harness(t),a=await seed(h);for(const action of ['create','trash','restore','select'])assert.equal((await h.call(h.member,'/api/ledgers',{action,id:a.id,name:'second',baseVersion:a.version})).status,403);
 const list=await h.call(h.member,'/api/ledgers');assert.equal(list.data.accounts.length,1);assert.equal(list.data.capabilities.multipleLedgers,false);
 assert.equal((await h.call(h.admin,'/api/ledgers',{action:'create',name:'Owner extra'})).status,201);
 assert.equal((await h.call(h.member,'/api/admin/member-backups')).status,403);
 await backup(h);assert.equal(Object.keys((await h.records()).data).some(k=>/backup/i.test(k)),false);
 const rename=await h.call(h.member,'/api/ledgers',{action:'rename',id:a.id,name:'更名',baseVersion:a.version});assert.equal(rename.status,200);
});
test('activation preserves selected ledger IDs/versions, archives extras and blocks old-client access',async t=>{
 const h=await harness(t,{single:false});await h.records();const extra=await h.call(h.member,'/api/ledgers',{action:'create',name:'selected'});const id=extra.data.account.id;
 const all=h.sqlite.prepare('SELECT account_id,version,dataset_json FROM trade_account_snapshots WHERE owner_user_id=?').all(h.member.userId);
 const restricted=createAccountApi({db:h.db,objects:h.objects,clientId:'fixture',singleLedger:true});const response=await restricted.handle(h.req(h.member,'/api/trade-records'));const data=await response.json();assert.equal(data.account.id,id);assert.equal(data.accounts.length,1);
 const archived=all.find(r=>r.account_id!==id);assert.ok(h.sqlite.prepare('SELECT archived_at FROM trade_account_snapshots WHERE account_id=?').get(archived.account_id).archived_at);assert.equal(h.sqlite.prepare('SELECT version FROM trade_account_snapshots WHERE account_id=?').get(archived.account_id).version,archived.version);
 for(const path of ['/api/trade-records','/api/workspace/bootstrap'])assert.equal((await restricted.handle(h.req(h.member,path+'?accountId='+archived.account_id))).status,403);
 assert.equal((await h.call(h.admin,`/api/admin/member-backups?action=archive-download&userId=${h.member.userId}&accountId=${archived.account_id}`)).status,200);
});
test('backup captures committed bytes once and independent copy survives history cleanup',async t=>{
 const h=await harness(t),a=await seed(h),w=await backup(h);assert.equal(w.source_version,a.version);assert.equal(w.source_hash,await sha256(h.objects.blobs.get(w.object_key).text));assert.equal(h.objects.blobs.get(w.object_key).text,h.objects.blobs.get(h.sqlite.prepare('SELECT object_key FROM trade_account_snapshots WHERE account_id=?').get(a.id).object_key).text);
 await h.save({accountId:a.id,accountName:a.name,baseVersion:a.version,dataset:cash(2000)});await backup(h);assert.equal(h.sqlite.prepare('SELECT source_version FROM member_weekly_backups').get().source_version,a.version);
 await pruneSnapshotHistory(h.db,{now:'2027-01-01T00:00:00Z'});await drainSnapshotObjects(h.db,h.objects);assert.ok(h.objects.blobs.has(w.object_key));
});
test('only newest weekly backup is retained, failure keeps previous and retry uses pinned source',async t=>{
 const h=await harness(t),a=await seed(h),old=await backup(h);await h.save({accountId:a.id,accountName:a.name,baseVersion:a.version,dataset:cash(2000)});
 const put=h.objects.put;h.objects.put=async()=>{throw Error('offline');};assert.equal((await runWeeklyMemberBackups(h.db,h.objects,{now:new Date(nextFriday)})).failed,1);assert.equal(h.sqlite.prepare('SELECT object_key FROM member_weekly_backups').get().object_key,old.object_key);
 const current=(await h.records()).data;await h.save({accountId:a.id,accountName:a.name,baseVersion:current.account.version,dataset:cash(3000)}); // fails while storage is offline
 h.objects.put=put;await backup(h,'2026-10-16T20:02:00Z');const latest=h.sqlite.prepare('SELECT * FROM member_weekly_backups').get();assert.equal(latest.source_version,a.version+1);await drainSnapshotObjects(h.db,h.objects);assert.equal(h.objects.blobs.has(old.object_key),false);assert.ok(h.objects.blobs.has(latest.object_key));
});
test('admin preview, confirmed restore, CAS conflict and old member page cannot overwrite recovery',async t=>{
 const h=await harness(t),a=await seed(h);await backup(h);await h.save({accountId:a.id,accountName:a.name,baseVersion:a.version,dataset:cash(2000)});
 const preview=(await h.call(h.admin,'/api/admin/member-backups?userId='+h.member.userId)).data;assert.equal(preview.home.fillCount,0);assert.equal(preview.cashActivityCount,1);
 const r=await h.call(h.admin,'/api/admin/member-backups',{action:'restore',userId:h.member.userId,baseVersion:preview.currentVersion,backupId:preview.backupId});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.account.id,a.id);assert.equal(r.data.account.version,preview.currentVersion+1);assert.equal((await h.records()).data.dataset.cashActivities[0].amount,1000);
 assert.equal((await h.save({accountId:a.id,accountName:a.name,baseVersion:preview.currentVersion,dataset:cash(4000)})).status,409);
 assert.equal((await h.call(h.admin,'/api/admin/member-backups',{action:'restore',userId:h.member.userId,baseVersion:preview.currentVersion,backupId:preview.backupId})).status,409);
 const event=h.sqlite.prepare("SELECT * FROM ledger_recovery_events WHERE result='SUCCESS'").get();assert.equal(event.actor_id,h.admin.userId);assert.equal(event.after_version,r.data.account.version);
 const home=h.sqlite.prepare('SELECT source_version,summary_json FROM ledger_home_views WHERE account_id=?').get(a.id);assert.equal(home.source_version,r.data.account.version);assert.equal(JSON.parse(home.summary_json).cashByCurrency.USD,1000);
});
test('missing or corrupted R2 backup stops preview and restore without changing live version',async t=>{
 const h=await harness(t),a=await seed(h),w=await backup(h);const original=h.objects.blobs.get(w.object_key);h.objects.blobs.set(w.object_key,{...original,text:'{}'});
 assert.equal((await h.call(h.admin,'/api/admin/member-backups?userId='+h.member.userId)).status,503);
 assert.equal((await h.call(h.admin,'/api/admin/member-backups',{action:'restore',userId:h.member.userId,baseVersion:a.version,backupId:w.object_key})).status,503);
 assert.equal((await h.records()).data.account.version,a.version);h.objects.blobs.delete(w.object_key);assert.equal((await h.call(h.admin,'/api/admin/member-backups?userId='+h.member.userId)).status,503);
});
test('failed jobs pin source and candidate files against GC, admin backup list is isolated',async t=>{
 const h=await harness(t),a=await seed(h);const get=h.objects.get;h.objects.get=async()=>{throw Error('timeout');};await runWeeklyMemberBackups(h.db,h.objects,{now:new Date(friday)});h.objects.get=get;
 const job=h.sqlite.prepare('SELECT * FROM member_backup_jobs').get();await h.save({accountId:a.id,accountName:a.name,baseVersion:a.version,dataset:cash(2000)});
 await pruneSnapshotHistory(h.db,{now:'2027-01-01T00:00:00Z'});await drainSnapshotObjects(h.db,h.objects);assert.ok(h.objects.blobs.has(job.source_object_key));await backup(h,'2026-10-09T20:02:00Z');
 const list=await h.call(h.admin,'/api/admin/member-backups');assert.equal(list.data.items.length,1);assert.equal(list.data.items[0].userId,h.member.userId);
});
test('revoked admin session and disabled member sessions fail closed',async t=>{
 const h=await harness(t);await seed(h);await backup(h);h.sqlite.prepare('DELETE FROM auth_sessions WHERE id=?').run(h.admin.sessionId);assert.equal((await h.call(h.admin,'/api/admin/member-backups')).status,401);
 h.sqlite.prepare("UPDATE app_users SET status='DISABLED' WHERE id=?").run(h.member.userId);assert.equal((await h.records()).status,403);
});
test('bootstrap still performs a single read and returns only primary ledger after activation',async t=>{
 const h=await harness(t);const a=await seed(h);let reads=0;const db={prepare(sql){assert.match(sql,/^SELECT/);reads++;return h.db.prepare(sql);}};
 const {data}=await loadWorkspaceBootstrap({db,request:h.req(h.member,'/api/workspace/bootstrap'),singleLedger:true});assert.equal(reads,1);assert.equal(data.account.id,a.id);assert.ok(data.home);assert.equal(Object.keys(data).some(k=>/backup/i.test(k)),false);
});
test('server enforces 500 completed cycles for full saves/imports while admin remains unrestricted',async t=>{
 const h=await harness(t),a=await seed(h),d=cash(1000);for(let i=0;i<501;i++)for(const [j,side] of ['BUY','SELL'].entries())d.fills.push({id:`${i}-${j}`,accountId:'main',symbol:'AAPL',market:'US',currency:'USD',side,quantity:1,price:100,fee:0,timestamp:new Date(Date.UTC(2026,0,1)+i*120000+j*60000).toISOString()});
 const partial={...d,fills:d.fills.slice(0,1000)};const r=await h.save({accountId:a.id,accountName:a.name,baseVersion:a.version,dataset:partial});assert.equal(r.status,200);
 const denied=await h.save({accountId:a.id,accountName:a.name,baseVersion:r.data.account.version,dataset:d});assert.equal(denied.status,422);assert.match(denied.data.error,/500/);assert.equal((await h.records()).data.dataset.fills.length,1000);
 const own=(await h.call(h.admin,'/api/trade-records')).data.account;assert.equal((await h.call(h.admin,'/api/trade-records',{accountId:own.id,accountName:'Owner',baseVersion:own.version,dataset:d},'PUT')).status,200);
});
test('R2 timeouts are bounded and concurrent runners produce one successful weekly pointer',async t=>{
 const h=await harness(t);await seed(h);const get=h.objects.get;h.objects.get=()=>new Promise(()=>{});const failed=await runWeeklyMemberBackups(h.db,h.objects,{now:new Date(friday),ioTimeout:5});assert.equal(failed.failed,1);h.objects.get=get;
 await Promise.all([runWeeklyMemberBackups(h.db,h.objects,{now:new Date('2026-10-09T20:02:00Z')}),runWeeklyMemberBackups(h.db,h.objects,{now:new Date('2026-10-09T20:02:00Z')})]);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM member_weekly_backups').get().n,1);assert.equal(h.sqlite.prepare("SELECT count(*) n FROM member_backup_jobs WHERE state='SUCCESS'").get().n,1);
});
