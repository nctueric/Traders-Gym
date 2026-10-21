import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {sqliteAdapter} from '../server/sqlite-adapter.mjs';
import {memoryObjects} from './cloud-objects.mjs';
import {emptyDataset} from '../lib/auth-core.mjs';
import {diffNormalizedDatasets} from '../lib/ledger-mutations.mjs';
import {backfillNormalizedLedgers,commitNormalizedMutation,listLedgerChanges,processLedgerJob,readNormalizedDataset,replaceNormalizedDataset,validateLedgerMutation} from '../lib/normalized-ledger.mjs';

function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const directory=new URL('../drizzle/',import.meta.url);for(const name of readdirSync(directory).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(name,directory),'utf8'));
 const db=sqliteAdapter(sqlite),objects=memoryObjects(),dataset=emptyDataset(),now='2026-10-10T00:00:00.000Z';
 sqlite.prepare("INSERT INTO app_users(id,email,name,picture,status,created_at,last_login_at) VALUES('owner','owner@example.test','Owner','','ACTIVE',?,?)").run(now,now);
 sqlite.prepare("INSERT INTO trade_account_snapshots(account_id,account_name,dataset_json,version,updated_at,owner_user_id,save_mode,size_bytes) VALUES('ledger','帳本',?,1,?,'owner','initial',?)").run(JSON.stringify(dataset),now,JSON.stringify(dataset).length);
 return {sqlite,db,objects,dataset};
}

test('normalized ledger commits only changed entities and rebuilds a complete dataset',async t=>{
 const {db,objects,dataset}=fixture(t);await replaceNormalizedDataset({db,accountId:'ledger',dataset,version:1,storageMode:'normalized'});
 const next=structuredClone(dataset);next.profile.name='快速帳本';next.fills.push({id:'fill-1',accountId:'main',symbol:'AAA',side:'BUY',quantity:1,price:10,timestamp:'2026-10-10T00:00:00Z'});
 const operations=diffNormalizedDatasets(dataset,next);assert.equal(operations.length,2);
 const checked=validateLedgerMutation({baseVersion:1,mutationId:'mutation-0001',operations});assert.equal(checked.ok,true);
 const saved=await commitNormalizedMutation({db,accountId:'ledger',ownerId:'owner',checked});assert.equal(saved.version,2);
 const row=await db.prepare('SELECT s.*,n.storage_mode,n.normalized_version FROM trade_account_snapshots s JOIN normalized_ledger_state n ON n.account_id=s.account_id WHERE s.account_id=?').bind('ledger').first();
 const rebuilt=await readNormalizedDataset({db,objects,row});assert.equal(rebuilt.profile.name,'快速帳本');assert.deepEqual(rebuilt.fills,next.fills);assert.deepEqual(rebuilt.marketBars,[]);
});

test('mutation IDs are idempotent and stale versions are rejected',async t=>{
 const {db,dataset}=fixture(t);await replaceNormalizedDataset({db,accountId:'ledger',dataset,version:1,storageMode:'normalized'});
 const checked=validateLedgerMutation({baseVersion:1,mutationId:'mutation-0002',operations:[{section:'profile',entityId:'profile',action:'upsert',value:{...dataset.profile,name:'一次'}}]});
 const first=await commitNormalizedMutation({db,accountId:'ledger',ownerId:'owner',checked}),again=await commitNormalizedMutation({db,accountId:'ledger',ownerId:'owner',checked});
 assert.equal(first.version,2);assert.equal(again.version,2);assert.equal(again.duplicate,true);
 const stale=validateLedgerMutation({baseVersion:1,mutationId:'mutation-0003',operations:[{section:'settings',entityId:'settings',action:'upsert',value:dataset.settings}]});
 await assert.rejects(commitNormalizedMutation({db,accountId:'ledger',ownerId:'owner',checked:stale}),error=>error.status===409);
});

test('background projection and immutable snapshot jobs can be retried safely',async t=>{
 const {db,objects,dataset}=fixture(t);await replaceNormalizedDataset({db,accountId:'ledger',dataset,version:1,storageMode:'normalized'});
 const checked=validateLedgerMutation({baseVersion:1,mutationId:'mutation-0004',operations:[{section:'profile',entityId:'profile',action:'upsert',value:{...dataset.profile,name:'背景完成'}}]});
 await commitNormalizedMutation({db,accountId:'ledger',ownerId:'owner',checked});
 const projection=await processLedgerJob({db,objects,job:{kind:'projection',accountId:'ledger',version:2}}),snapshot=await processLedgerJob({db,objects,job:{kind:'snapshot',accountId:'ledger',version:2}});
 assert.equal(projection.version,2);assert.equal(snapshot.version,2);assert.ok(objects.blobs.has(snapshot.objectKey));
 assert.equal((await processLedgerJob({db,objects,job:{kind:'snapshot',accountId:'ledger',version:2}})).skipped,true);
 const state=await db.prepare('SELECT * FROM normalized_ledger_state WHERE account_id=?').bind('ledger').first();assert.equal(state.projection_version,2);assert.equal(state.snapshot_version,2);assert.equal(state.projection_pending,0);assert.equal(state.snapshot_pending,0);
});

test('change feed returns ordered operations and rejects versions outside retention',async t=>{
 const {db,dataset}=fixture(t);await replaceNormalizedDataset({db,accountId:'ledger',dataset,version:1,storageMode:'normalized'});
 const checked=validateLedgerMutation({baseVersion:1,mutationId:'mutation-0005',operations:[{section:'profile',entityId:'profile',action:'upsert',value:{...dataset.profile,name:'變更'}}]});await commitNormalizedMutation({db,accountId:'ledger',ownerId:'owner',checked});
 const feed=await listLedgerChanges({db,accountId:'ledger',ownerId:'owner',afterVersion:1});assert.equal(feed.version,2);assert.equal(feed.changes.length,1);assert.equal(feed.changes[0].operations[0].value.name,'變更');
 await assert.rejects(listLedgerChanges({db,accountId:'ledger',ownerId:'owner',afterVersion:0}),error=>error.status===410);
});

test('shadow backfill compares JSON semantics instead of object key order and retries prior errors',async t=>{
 const {sqlite,db,objects,dataset}=fixture(t),reordered={settings:dataset.settings,marketBars:[],fills:[],accounts:dataset.accounts,profile:dataset.profile,version:dataset.version,cashActivities:[],positionPlans:{},cycleReviews:{},decisionLinks:{},decisionLinkHistory:[],planHistory:[],improvementExperiments:[],strategies:[],strategyAssignments:{}};
 await objects.put('snapshots/ledger.json',JSON.stringify(reordered));
 sqlite.prepare("UPDATE trade_account_snapshots SET dataset_json='{}',object_key='snapshots/ledger.json',size_bytes=? WHERE account_id='ledger'").run(JSON.stringify(reordered).length);
 await replaceNormalizedDataset({db,accountId:'ledger',dataset:reordered,version:1,storageMode:'shadow'});
 sqlite.prepare("UPDATE normalized_ledger_state SET last_error='先前誤判' WHERE account_id='ledger'").run();
 const result=await backfillNormalizedLedgers({db,objects,limit:1});
 assert.equal(result.results[0].verified,true);
 assert.equal((await db.prepare("SELECT last_error FROM normalized_ledger_state WHERE account_id='ledger'").first()).last_error,null);
});


test('replacement updates only changed rows, independent of historical fill count',async t=>{
 const {db,sqlite,dataset}=fixture(t);
 dataset.fills=Array.from({length:600},(_,i)=>({id:`f${i}`,symbol:'AAA',quantity:1,price:10}));
 await replaceNormalizedDataset({db,accountId:'ledger',dataset,version:1,storageMode:'shadow'});
 sqlite.exec(`CREATE TABLE audit_changes(kind TEXT); CREATE TRIGGER watch_fill_update AFTER UPDATE ON ledger_fills BEGIN INSERT INTO audit_changes VALUES('fill'); END; CREATE TRIGGER watch_fill_delete AFTER DELETE ON ledger_fills BEGIN INSERT INTO audit_changes VALUES('fill'); END;`);
 const next=structuredClone(dataset);next.positionPlans={a:{stopLoss:9}};
 const result=await replaceNormalizedDataset({db,accountId:'ledger',dataset:next,version:2,storageMode:'shadow'});
 assert.equal(result.entities,1);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM audit_changes').get().n,0);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM ledger_fills').get().n,600);
 next.fills=next.fills.slice(0,-1);await replaceNormalizedDataset({db,accountId:'ledger',dataset:next,version:3,storageMode:'shadow'});
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM audit_changes').get().n,1);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM ledger_fills').get().n,599);
});
