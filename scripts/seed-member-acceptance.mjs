// Creates synthetic identities only in the fixed, isolated acceptance database.
import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {hashPassword} from '../lib/password-auth.mjs';
const path=fileURLToPath(new URL('../data/private/member-workflow-acceptance/accounts.sqlite',import.meta.url));
if(!existsSync(path))throw new Error('請先啟動 npm run dev:acceptance，建立隔離資料庫。');
const password=process.env.ACCEPTANCE_PASSWORD;
if(!password||[...password].length<12)throw new Error('請以 ACCEPTANCE_PASSWORD 指定至少 12 字元的隔離測試密碼。');
const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON');
const owner=db.prepare('SELECT user_id FROM system_owner').get();
if(owner&&owner.user_id!=='acceptance-admin')throw new Error('隔離資料庫已有另一位擁有者，已停止，不覆寫。');
const hash=await hashPassword(password),time=new Date().toISOString();
db.exec('BEGIN IMMEDIATE');
try{
 for(const [id,email,name,sub] of [['acceptance-admin','admin-acceptance@example.com','隔離驗收管理者','synthetic-acceptance-owner'],['acceptance-member','acceptance@example.com','隔離驗收會員',null]]){
  db.prepare("INSERT OR IGNORE INTO app_users(id,google_sub,email,name,picture,status,created_at,last_login_at) VALUES(?,?,?,?,'','ACTIVE',?,?)").run(id,sub,email,name,time,time);
  db.prepare('INSERT OR IGNORE INTO email_credentials(user_id,password_hash,verified_at,updated_at) VALUES(?,?,?,?)').run(id,hash,time,time);
 }
 db.prepare('INSERT OR IGNORE INTO system_owner(id,user_id,google_sub) VALUES(1,?,?)').run('acceptance-admin','synthetic-acceptance-owner');
 db.exec('COMMIT');
 console.log('隔離驗收帳號已備妥：admin-acceptance@example.com、acceptance@example.com；既有密碼與帳本未覆寫。');
} catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
