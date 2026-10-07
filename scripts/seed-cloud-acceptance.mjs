// Synthetic acceptance identity; never connects to deployed D1/R2 or writes a ledger file.
import {Miniflare} from 'miniflare';import {fileURLToPath} from 'node:url';import {join} from 'node:path';import {hashPassword} from '../lib/password-auth.mjs';
const directory=fileURLToPath(new URL('../.wrangler/guest-cloud-acceptance/',import.meta.url));
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test");}}',compatibilityDate:'2026-05-01',d1Databases:['DB'],r2Buckets:['SNAPSHOTS'],d1Persist:join(directory,'d1'),r2Persist:join(directory,'r2')});
try{
 const db=await mf.getD1Database('DB'),now=new Date().toISOString(),hash=await hashPassword('Cloud-acceptance-only-2026');
 await db.batch([db.prepare("INSERT INTO app_users(id,email,name,status,created_at,last_login_at) VALUES('cloud-acceptance','cloud-check@example.test','雲端驗收測試','ACTIVE',?,?) ON CONFLICT(id) DO NOTHING").bind(now,now),db.prepare("INSERT INTO email_credentials(user_id,password_hash,verified_at,updated_at) VALUES('cloud-acceptance',?,?,?) ON CONFLICT(user_id) DO NOTHING").bind(hash,now,now)]);
 console.log('Isolated D1 acceptance identity ready: cloud-check@example.test');
}finally{await mf.dispose();}
