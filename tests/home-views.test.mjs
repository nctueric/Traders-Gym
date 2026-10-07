import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudStore} from './cloud-store.mjs';
import {sqliteAdapter} from '../server/sqlite-adapter.mjs';
import {buildHomeView,homeAmounts,backfillHomeViews} from '../lib/home-views.mjs';
import {bootstrapResponse} from '../lib/workspace-bootstrap.mjs';
import {buildCurrentEquity} from '../lib/portfolio-engine.mjs';
import {emptyDataset,COOKIE_NAME} from '../lib/auth-core.mjs';
const stamp='2026-10-07T02:00:00.000Z';
function fixture(){return {...emptyDataset(),cashActivities:[{id:'cash',type:'DEPOSIT',currency:'USD',amount:10000,timestamp:'2026-01-01T00:00:00Z'}],fills:[{id:'a',accountId:'us',symbol:'AAPL',market:'US',currency:'USD',side:'BUY',quantity:10,price:200,fee:1,timestamp:'2026-01-02T00:00:00Z'},{id:'b',accountId:'tw',symbol:'2330',market:'TWSE',currency:'TWD',side:'SELL',quantity:2,price:1000,fee:0,timestamp:'2026-01-02T00:00:00Z'}],marketSnapshot:{version:1,quotes:{AAPL:{price:210,source:'fixture',updatedAt:stamp},'2330.TW':{price:900,source:'fixture',updatedAt:stamp},'USDTWD=X':{price:32,source:'fixture',updatedAt:stamp}}}};}
async function harness(t){const h=await cloudStore(t);const session=h.sqlite.prepare('SELECT * FROM auth_sessions').get();
 // The token cannot be recovered from its hash; add an isolated Google session.
 const {sha256}=await import('../lib/auth-core.mjs');const token='c'.repeat(64);h.sqlite.prepare('INSERT INTO auth_sessions(id,user_id,token_hash,expires_at,created_at,provider) VALUES(?,?,?,?,?,?)').run('home-test-session',session.user_id,await sha256(token),session.expires_at,session.created_at,session.provider);session.id='home-test-session';
 const req=(accountId='test',header=session.id)=>new Request(`https://test.example/api/workspace/bootstrap?accountId=${accountId}`,{headers:{Cookie:`${COOKIE_NAME}=${token}`,'x-workspace-session':header}});
 return {...h,db:sqliteAdapter(h.sqlite),req};}
const save=(h,data=fixture(),version=0)=>h.store.save({accountId:'test',accountName:'Test',dataset:data,baseVersion:version});
test('home projections match native equity and FIFO costs in USD/TWD, shorts and missing FX',()=>{
 const data=fixture(),home=buildHomeView(data,new Date(stamp)),equity=buildCurrentEquity(data,data.marketSnapshot.quotes,32,new Date(stamp));
 assert.deepEqual(home.assetByCurrency,equity.assetByCurrency);assert.deepEqual(home.cashByCurrency,equity.cashByCurrency);
 assert.equal(homeAmounts(home,'USD',Date.parse(stamp)).total,equity.totalUsd);assert.equal(homeAmounts(home,'USD',Date.parse(stamp)).gross,equity.grossPositionValueUsd);
 assert.equal(homeAmounts(home,'TWD',Date.parse(stamp)).total,equity.totalUsd*32);assert.equal(home.positions.find(p=>p.symbol==='2330').unrealized,200);
 assert.equal(homeAmounts(home,'USD',Date.parse(stamp)+121000).total,null);
 delete data.marketSnapshot.quotes.AAPL;assert.equal(homeAmounts(buildHomeView(data),'USD').total,null);
 const pure={...emptyDataset(),cashActivities:[{id:'cash',type:'DEPOSIT',currency:'USD',amount:100,timestamp:stamp}]};assert.equal(homeAmounts(buildHomeView(pure),'USD').total,100);assert.equal(homeAmounts(buildHomeView(pure),'TWD').total,null);
});
test('bootstrap uses one read without R2 or writes, combines preferences and exact committed version',async t=>{
 const h=await harness(t);await save(h);h.sqlite.prepare('INSERT INTO member_preferences(user_id,preferences_json) SELECT owner_user_id,? FROM trade_account_snapshots').run(JSON.stringify({valuationCurrency:'TWD'}));
 let reads=0;const db={prepare(sql){assert.match(sql,/^SELECT/);reads++;return h.db.prepare(sql);}};
 const response=await bootstrapResponse({db,request:h.req()});assert.equal(response.status,200);assert.match(response.headers.get('Server-Timing'),/auth;dur=.*d1;dur=.*summary;dur=.*serialize;dur=/);assert.equal(response.headers.get('Cache-Control'),'no-store');
 const body=await response.json();assert.equal(reads,1);assert.equal(body.account.version,1);assert.equal(body.preferences.valuationCurrency,'TWD');assert.equal(body.home.fillCount,2);assert.ok(Buffer.byteLength(JSON.stringify(body))<65536);assert.equal(body.dataset,undefined);
});
test('bootstrap fails closed for foreign owners, wrong session, expired and disabled users',async t=>{
 const h=await harness(t);await save(h);assert.equal((await bootstrapResponse({db:h.db,request:h.req('other')})).status,403);assert.equal((await bootstrapResponse({db:h.db,request:h.req('test','wrong')})).status,401);
 h.sqlite.exec("UPDATE auth_sessions SET expires_at='2000-01-01'");assert.equal((await bootstrapResponse({db:h.db,request:h.req()})).status,401);
 h.sqlite.exec("UPDATE auth_sessions SET expires_at='2099-01-01';UPDATE app_users SET status='DISABLED'");assert.equal((await bootstrapResponse({db:h.db,request:h.req()})).status,403);
});
test('missing/stale/corrupt views and rollback flag preserve the complete-load path',async t=>{
 const h=await harness(t);assert.equal((await(await bootstrapResponse({db:h.db,request:h.req()})).json()).home,null);await save(h);
 assert.equal((await(await bootstrapResponse({db:h.db,request:h.req(),enabled:false})).json()).home,null);
 h.sqlite.exec('UPDATE ledger_home_views SET source_version=0');assert.equal((await(await bootstrapResponse({db:h.db,request:h.req()})).json()).home,null);
 h.sqlite.exec("UPDATE ledger_home_views SET source_version=1,summary_json='bad'");assert.equal((await(await bootstrapResponse({db:h.db,request:h.req()})).json()).fallback,true);
});
test('view failure rolls back the ledger pointer, conflicts cannot replace the current view',async t=>{
 const h=await harness(t);await save(h);const before=h.sqlite.prepare('SELECT * FROM trade_account_snapshots').get(),view=h.sqlite.prepare('SELECT * FROM ledger_home_views').get();
 h.sqlite.exec("CREATE TRIGGER reject_view BEFORE UPDATE ON ledger_home_views BEGIN SELECT RAISE(ABORT,'view unavailable');END;");
 await assert.rejects(save(h,fixture(),1));assert.deepEqual(h.sqlite.prepare('SELECT * FROM trade_account_snapshots').get(),before);assert.deepEqual(h.sqlite.prepare('SELECT * FROM ledger_home_views').get(),view);
 h.sqlite.exec('DROP TRIGGER reject_view');await assert.rejects(save(h,fixture(),0),e=>e.status===409);assert.deepEqual(h.sqlite.prepare('SELECT * FROM ledger_home_views').get(),view);
});
test('backfill checks source integrity, is idempotent and leaves IDs, versions and bytes untouched',async t=>{
 const h=await harness(t);await save(h);const before=h.sqlite.prepare('SELECT * FROM trade_account_snapshots').get();h.sqlite.exec('DELETE FROM ledger_home_views');
 const item=h.objects.blobs.get(before.object_key),valid=item.text;item.text+='bad';await assert.rejects(backfillHomeViews(h),/校驗/);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM ledger_home_views').get().n,0);
 item.text=valid;assert.equal((await backfillHomeViews(h)).rebuilt,1);assert.deepEqual(h.sqlite.prepare('SELECT * FROM trade_account_snapshots').get(),before);assert.equal((await backfillHomeViews(h)).examined,0);
});
test('large history stays outside summary and more than twenty holdings are truncated after aggregation',()=>{
 const data=fixture();data.fills=Array.from({length:30},(_,i)=>({...data.fills[0],id:`f${i}`,symbol:`A${i}`}));data.marketBars=Array.from({length:50000},(_,i)=>({symbol:'AAPL',date:'2026-01-02',open:200,high:220,low:199,close:210,volume:i}));for(const f of data.fills)data.marketSnapshot.quotes[f.symbol]={price:210,updatedAt:stamp};
 const h=buildHomeView(data,new Date(stamp));assert.equal(h.positionCount,30);assert.equal(h.positions.length,20);assert.ok(Buffer.byteLength(JSON.stringify(h))<65536);assert.equal(h.marketBars,undefined);assert.equal(h.assetByCurrency.USD,12970);
});
test('email credential revocation is enforced without a second identity query',async t=>{
 const h=await harness(t);await save(h);const {sha256}=await import('../lib/auth-core.mjs');const owner=h.sqlite.prepare('SELECT owner_user_id FROM trade_account_snapshots').get().owner_user_id;
 h.sqlite.prepare('INSERT INTO email_credentials VALUES(?,?,?,?)').run(owner,'fixture-verifier',stamp,stamp);h.sqlite.exec("UPDATE auth_sessions SET provider='email' WHERE id='home-test-session'");h.sqlite.prepare('INSERT INTO member_session_credentials VALUES(?,?)').run('home-test-session',await sha256('fixture-verifier'));
 assert.equal((await bootstrapResponse({db:h.db,request:h.req()})).status,200);h.sqlite.exec("UPDATE email_credentials SET password_hash='rotated-verifier'");assert.equal((await bootstrapResponse({db:h.db,request:h.req()})).status,401);
});
test('summary corruption falls back safely; rebuilding restores it without rewriting the snapshot',async t=>{
 const h=await harness(t);await save(h);h.sqlite.exec("UPDATE ledger_home_views SET summary_json='broken'");assert.equal((await(await bootstrapResponse({db:h.db,request:h.req()})).json()).home,null);assert.equal((await backfillHomeViews(h)).rebuilt,1);assert.ok((await(await bootstrapResponse({db:h.db,request:h.req()})).json()).home);
});
test('legacy password verifier rotation and owner restriction match the formal authenticator',async t=>{
 const h=await harness(t);await save(h);const {sha256}=await import('../lib/auth-core.mjs');const OWNER_EMAIL='legacy-owner@example.test';const personal='personal_'+await sha256(OWNER_EMAIL),old=h.sqlite.prepare('SELECT owner_user_id FROM trade_account_snapshots').get().owner_user_id;
 h.sqlite.prepare("INSERT INTO app_users(id,email,name,status,created_at,last_login_at) VALUES(?,?,?,'ACTIVE',?,?)").run(personal,OWNER_EMAIL,'Legacy owner',stamp,stamp);h.sqlite.prepare('UPDATE auth_sessions SET user_id=?').run(personal);h.sqlite.prepare('UPDATE trade_account_snapshots SET owner_user_id=?').run(personal);h.sqlite.prepare('UPDATE ledger_home_views SET owner_user_id=?').run(personal);h.sqlite.prepare('UPDATE system_owner SET user_id=?').run(personal);h.sqlite.exec("UPDATE auth_sessions SET provider='password' WHERE id='home-test-session'");h.sqlite.prepare('INSERT INTO password_session_credentials VALUES(?,?)').run('home-test-session',await sha256('fixture-password-verifier'));
 const options={db:h.db,request:h.req(),passwordEmail:OWNER_EMAIL,passwordHash:'fixture-password-verifier'};assert.equal((await bootstrapResponse(options)).status,200);assert.equal((await bootstrapResponse({...options,passwordHash:'rotated-password-verifier'})).status,401);assert.equal((await bootstrapResponse({...options,passwordHash:''})).status,401);
 h.sqlite.prepare("UPDATE system_owner SET user_id=?").run(old);assert.equal((await bootstrapResponse(options)).status,401);
});
test('valid JSON with malformed summary fields falls back instead of crashing SSR or inventing values',async t=>{
 const h=await harness(t);await save(h);const valid=JSON.parse(h.sqlite.prepare('SELECT summary_json FROM ledger_home_views').get().summary_json);
 for(const home of [{...valid,asOf:0},{...valid,positions:[{...valid.positions[0],quoteAt:{invalid:true}}]},{...valid,missingQuotes:undefined},{...valid,positions:[{...valid.positions[0],direction:'UNKNOWN'}]}]){h.sqlite.prepare('UPDATE ledger_home_views SET summary_json=?').run(JSON.stringify(home));const r=await bootstrapResponse({db:h.db,request:h.req()});assert.equal(r.status,200);assert.equal((await r.json()).home,null);}
});
test('a mismatched view owner cannot expose data and verified backfill repairs only the summary binding',async t=>{
 const h=await harness(t);await save(h);const before=h.sqlite.prepare('SELECT * FROM trade_account_snapshots').get();h.sqlite.prepare("INSERT INTO app_users(id,email,name,status,created_at,last_login_at) VALUES('other','other@example.test','Other','ACTIVE',?,?)").run(stamp,stamp);h.sqlite.exec("UPDATE ledger_home_views SET owner_user_id='other'");assert.equal((await(await bootstrapResponse({db:h.db,request:h.req()})).json()).home,null);assert.equal((await backfillHomeViews(h)).rebuilt,1);assert.deepEqual(h.sqlite.prepare('SELECT * FROM trade_account_snapshots').get(),before);assert.ok((await(await bootstrapResponse({db:h.db,request:h.req()})).json()).home);
});
