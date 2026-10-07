// Uses only the disposable QA deployment and its synthetic sessions. Never production.
import {readFile,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {emptyDataset} from '../lib/auth-core.mjs';
const origin='https://traders-gym-backup-qa-20261007.nctueric.workers.dev',sessions=JSON.parse(await readFile('data/private/member-backups-remote/session.json','utf8'));
const call=async(who,path,body,method=body?'POST':'GET')=>{const response=await fetch(origin+path,{method,headers:{Cookie:'tg_session='+sessions[who+'Token'],'x-workspace-session':'qa-'+who+'-session',Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const text=await response.text();let data;try{data=JSON.parse(text);}catch{throw Error(path+' HTTP '+response.status+' non-JSON response '+text.slice(0,100));}return {status:response.status,data};};
if(process.argv.includes('--dispose')){const r=await call('admin','/test/dispose',{});assert.equal(r.status,200);console.log(JSON.stringify(r.data));process.exit();}
assert.equal((await fetch(origin+'/api/admin/member-backups')).status,401);
assert.equal((await call('member','/api/admin/member-backups')).status,403);
const first=await call('member','/api/trade-records');assert.equal(first.status,200);const account=first.data.account;
assert.equal((await call('member','/api/ledgers',{action:'create',name:'forbidden'})).status,403);
const dataset=emptyDataset();dataset.cashActivities=[{id:'cash',type:'DEPOSIT',currency:'USD',amount:10000,timestamp:'2026-10-01T00:00:00Z'}];
const save=async(version,amount)=>{dataset.cashActivities[0].amount=amount;const r=await call('member','/api/trade-records',{accountId:account.id,accountName:'Synthetic QA',baseVersion:version,dataset},'PUT');assert.equal(r.status,200,JSON.stringify(r));return r.data.account;};
let a=await save(account.version,10000);
const initial=await call('admin','/test/run',{now:'2026-10-09T20:00:00Z'});assert.equal(initial.status,200);assert.equal(initial.data.completed,1);assert.equal(initial.data.failed,0);
assert.equal((await call('admin','/test/run',{now:'2026-10-09T20:01:00Z'})).data.completed,0);
a=await save(a.version,20000);
let preview=await call('admin','/api/admin/member-backups?userId=qa-member');assert.equal(preview.status,200);assert.equal(preview.data.sourceVersion,a.version-1);
const stale=await call('admin','/api/admin/member-backups',{action:'restore',userId:'qa-member',backupId:preview.data.backupId,baseVersion:a.version-1});assert.equal(stale.status,409);
const restored=await call('admin','/api/admin/member-backups',{action:'restore',userId:'qa-member',backupId:preview.data.backupId,baseVersion:a.version});assert.equal(restored.status,200,JSON.stringify(restored));a=restored.data.account;
const records=await call('member','/api/trade-records');assert.equal(records.data.dataset.cashActivities[0].amount,10000);assert.equal(records.data.account.id,account.id);assert.equal(records.data.accounts.length,1);
const home=await call('member','/api/workspace/bootstrap');assert.equal(home.status,200);assert.equal(home.data.home.cashByCurrency.USD,10000);assert.equal(home.data.account.version,a.version);
const old=preview.data.backupId;await call('admin','/test/run',{now:'2026-10-16T20:00:00Z'});preview=await call('admin','/api/admin/member-backups?userId=qa-member');assert.notEqual(preview.data.backupId,old);await call('admin','/test/cleanup',{});const keys=(await call('admin','/test/objects')).data.objects.map(o=>o.key);assert.equal(keys.includes(old),false);assert.equal(keys.filter(k=>k.startsWith('weekly-backups/')).length,1);
const d={...dataset,fills:[]};for(let i=0;i<501;i++)for(const [j,side] of ['BUY','SELL'].entries())d.fills.push({id:`f-${i}-${j}`,accountId:'main',symbol:'AAPL',market:'US',currency:'USD',side,quantity:1,price:100,fee:0,timestamp:new Date(Date.UTC(2026,0,1)+i*120000+j*60000).toISOString()});
assert.equal((await call('member','/api/trade-records',{accountId:a.id,accountName:'Synthetic QA',baseVersion:a.version,dataset:d},'PUT')).status,422);
const events=(await call('admin','/api/admin/member-backups?action=events&userId=qa-member')).data.events;assert.ok(events.some(e=>e.result==='SUCCESS'));assert.ok(events.some(e=>e.result==='CONFLICT'));
const report={at:new Date().toISOString(),environment:'temporary Cloudflare APAC D1/R2 Worker; synthetic data only',origin,anonymousDenied:true,memberBackupDenied:true,singleLedger:true,verifiedWeeklyBackup:true,duplicateScheduleSkipped:true,restoreCAS:true,restoredCash:10000,consistentHome:true,newestBackupOnly:true,cycle501Rejected:true,auditEvents:events.length};await writeFile('docs/acceptance/member-backups/cloudflare.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
