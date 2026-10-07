import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';
import {legacyFileRows} from '../server/legacy-record-reader.mjs';
const dataset={profile:{name:'owned'},accounts:[],fills:[],marketBars:[],settings:{}};
test('legacy server files export only verified ownership/checksum, never write or bootstrap identity',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tg-legacy-read-'));t.after(()=>rm(directory,{recursive:true,force:true}));await mkdir(join(directory,'目前帳號'));
 const db=new DatabaseSync(join(directory,'accounts.sqlite'));db.exec(`CREATE TABLE app_users(id TEXT PRIMARY KEY,google_sub TEXT);CREATE TABLE trade_account_snapshots(account_id TEXT,account_name TEXT,owner_user_id TEXT);INSERT INTO app_users VALUES('owner','sub');INSERT INTO trade_account_snapshots VALUES('primary','old','owner');`);db.close();
 const path=join(directory,'目前帳號','primary.json'),original=JSON.stringify({...dataset,_storage:{accountId:'primary',version:8,sha256:createHash('sha256').update(JSON.stringify(dataset)).digest('hex')}});await writeFile(path,original);
 const get=async id=>{const response=await legacyFileRows(new Request('https://test.example/api/legacy-records'),{directory,authenticate:async()=>({id})});return response.json();};
 assert.equal((await get('owner')).records[0].version,8);assert.deepEqual((await get('owner')).records[0].dataset,dataset);assert.equal((await get('another')).records.length,0);assert.equal(await readFile(path,'utf8'),original);
 await writeFile(path,original.replace('owned','tampered'));assert.equal((await get('owner')).records.length,0);
 const response=await legacyFileRows(new Request('https://test.example/api/legacy-records',{method:'POST'}),{directory,authenticate:async()=>({id:'owner'})});assert.equal(response.status,405);
});
