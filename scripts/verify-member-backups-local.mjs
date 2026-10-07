// Disposable local D1/R2 acceptance. No production bindings or private ledgers.
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {unstable_splitSqlQuery} from 'wrangler';
import {createAccountApi} from '../lib/account-api.mjs';
import {createPasswordAuth,hashPassword} from '../lib/password-auth.mjs';
import {createMixedAuthenticator} from '../lib/mixed-auth.mjs';
import {COOKIE_NAME,signIn,emptyDataset,sha256} from '../lib/auth-core.mjs';
import {runWeeklyMemberBackups} from '../lib/member-weekly-backups.mjs';
import assert from 'node:assert/strict';
const directory=resolve('.wrangler/member-backups-acceptance');mkdirSync(directory,{recursive:true});
const emulator=new Miniflare({modules:true,script:'export default {fetch(){return new Response("acceptance");}}',compatibilityDate:'2026-05-01',d1Databases:['DB'],r2Buckets:['SNAPSHOTS'],d1Persist:join(directory,'d1'),r2Persist:join(directory,'r2')});
try{
 const db=await emulator.getD1Database('DB'),objects=await emulator.getR2Bucket('SNAPSHOTS');
 await db.prepare('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)').run();
 for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())if(!await db.prepare('SELECT name FROM local_migrations WHERE name=?').bind(name).first())await db.batch([...unstable_splitSqlQuery(readFileSync(join('drizzle',name),'utf8')).map(sql=>db.prepare(sql)),db.prepare('INSERT INTO local_migrations VALUES(?)').bind(name)]);
 const password='Backup-acceptance-only-2026',hash=await hashPassword(password),email='backup-admin@example.test';
 const pwd=createPasswordAuth({db,email,passwordHash:hash}),authenticate=createMixedAuthenticator(db,pwd);
 const login=await pwd.login(new Request('http://127.0.0.1:3110/api/auth/password',{method:'POST',headers:{Origin:'http://127.0.0.1:3110','Content-Type':'application/json'},body:JSON.stringify({email,password})}));assert.equal(login.status,200);
 const admin=await db.prepare('SELECT id FROM app_users WHERE id=?').bind('personal_'+await sha256(email)).first();await db.prepare('INSERT OR IGNORE INTO system_owner(id,user_id,google_sub) VALUES(1,?,?)').bind(admin.id,'backup-local-owner').run();
 const member=await signIn(db,{sub:'backup-local-member',email:'backup-member@example.test',name:'隔離測試會員',email_verified:true},{openGoogleLogin:true});
 await db.prepare('INSERT OR REPLACE INTO email_credentials(user_id,password_hash,verified_at,updated_at) VALUES(?,?,?,?)').bind(member.userId,hash,new Date().toISOString(),new Date().toISOString()).run();
 const api=createAccountApi({db,objects,authenticate,clientId:'fixture',singleLedger:true,weeklyBackupsEnabled:true});
 const req=(body)=>new Request('http://127.0.0.1:3110/api/trade-records',{method:body?'PUT':'GET',headers:{Cookie:`${COOKIE_NAME}=${member.token}`,Origin:'http://127.0.0.1:3110','x-workspace-session':member.sessionId,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const account=(await (await api.handle(req())).json()).account;
 const dataset=emptyDataset();dataset.cashActivities=[{id:'fixture-cash',type:'DEPOSIT',currency:'USD',amount:10000,timestamp:'2026-10-01T00:00:00Z'}];
 const saved=await api.handle(req({accountId:account.id,accountName:'隔離驗收帳本',baseVersion:account.version,dataset}));assert.equal(saved.status,200);
 assert.equal((await runWeeklyMemberBackups(db,objects,{now:new Date('2026-10-09T20:00:00Z')})).failed,0);
 const current=(await (await api.handle(req())).json()).account;
 dataset.cashActivities[0].amount=20000;assert.equal((await api.handle(req({accountId:account.id,accountName:current.name,baseVersion:current.version,dataset}))).status,200);
 await writeFile(join(directory,'ui.env'),`LOCAL_CLOUD_DIRECTORY=${directory}\nLOCAL_PERSONAL_EMAIL=${email}\nLOCAL_PASSWORD_HASH_BASE64=${Buffer.from(hash).toString('base64')}\n`);
 const report={environment:'isolated local Miniflare D1/R2',primaryLedger:true,backupStored:true,memberPassword:password,adminEmail:email,memberEmail:'backup-member@example.test'};
 mkdirSync('docs/acceptance/member-backups',{recursive:true});await writeFile('docs/acceptance/member-backups/local.json',JSON.stringify({...report,memberPassword:undefined},null,2));console.log('Isolated local D1/R2 acceptance passed; synthetic UI accounts seeded.');
}finally{await emulator.dispose();}
