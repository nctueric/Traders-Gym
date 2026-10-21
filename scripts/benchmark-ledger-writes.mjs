// Synthetic local D1 only. Never accepts production identifiers or credentials.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {unstable_splitSqlQuery} from 'wrangler';
import {emptyDataset} from '../lib/auth-core.mjs';
import {replaceNormalizedDataset,commitNormalizedMutation,validateLedgerMutation} from '../lib/normalized-ledger.mjs';
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("isolated test");}}',compatibilityDate:'2026-05-01',d1Databases:['DB']});
try{
 const raw=await mf.getD1Database('DB');let written=0;
 const db={prepare:sql=>raw.prepare(sql),batch:async statements=>{const result=await raw.batch(statements);written+=result.reduce((n,r)=>n+r.meta.rows_written,0);return result;}};
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await raw.batch(unstable_splitSqlQuery(readFileSync(`drizzle/${file}`,'utf8')).map(sql=>raw.prepare(sql)));
 const dataset=emptyDataset();dataset.fills=Array.from({length:600},(_,i)=>({id:`fill-${i}`,symbol:'SYNTH',quantity:1,price:10}));
 await raw.prepare("INSERT INTO trade_account_snapshots(account_id,account_name,dataset_json,version,updated_at) VALUES('quota-fixture','Synthetic','{}',1,?)").bind(new Date().toISOString()).run();
 await replaceNormalizedDataset({db,accountId:'quota-fixture',dataset,version:1});
 // Reproduce the previous full delete/reinsert behavior for historical fills only.
 written=0;
 await db.batch([raw.prepare("DELETE FROM ledger_fills WHERE account_id='quota-fixture'"),...dataset.fills.map((f,i)=>raw.prepare("INSERT INTO ledger_fills(account_id,entity_id,ordinal,sort_key,symbol,payload_json,updated_version) VALUES('quota-fixture',?,?,'',?,?,1)").bind(f.id,i,f.symbol,JSON.stringify(f)))]);
 const oldHistoricalRows=written;
 written=0;dataset.positionPlans={position:{stopLoss:9}};
 await replaceNormalizedDataset({db,accountId:'quota-fixture',dataset,version:2});
 const optimizedRows=written;
 assert.equal((await raw.prepare('SELECT COUNT(*) n FROM ledger_fills').first()).n,600);
 assert.ok(oldHistoricalRows>optimizedRows*100);
 await raw.prepare("INSERT INTO app_users(id,google_sub,email,name,picture,status,created_at,last_login_at) VALUES('qa','qa','qa@example.invalid','QA','','ACTIVE',?,?)").bind(new Date().toISOString(),new Date().toISOString()).run();
 await raw.prepare("UPDATE trade_account_snapshots SET owner_user_id='qa',version=2 WHERE account_id='quota-fixture'").run();
 await raw.prepare("UPDATE normalized_ledger_state SET storage_mode='normalized' WHERE account_id='quota-fixture'").run();
 written=0;
 await commitNormalizedMutation({db,accountId:'quota-fixture',ownerId:'qa',checked:validateLedgerMutation({baseVersion:2,mutationId:'quota-fixture-change',operations:[{section:'positionPlans',entityId:'position',action:'upsert',value:{stopLoss:8}}]})});
 const incrementalCommitRows=written;
 const report={incrementalCommitRows,environment:'Local Miniflare D1; synthetic data only',at:new Date().toISOString(),historicalFills:600,previousHistoricalRewriteRows:oldHistoricalRows,optimizedPlanReplacementRows:optimizedRows,note:'Uses D1 result.meta.rows_written including local engine index maintenance. Previous count covers only fills; replacement includes the plan and state; incrementalCommitRows includes the foreground transaction and audit records, excluding asynchronous snapshot jobs. Production totals must be observed after release.'};
 mkdirSync('docs/acceptance/d1-writes',{recursive:true});writeFileSync('docs/acceptance/d1-writes/benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await mf.dispose();}
