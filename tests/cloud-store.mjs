import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {sqliteAdapter} from '../server/sqlite-adapter.mjs';
import {createAccountApi} from '../lib/account-api.mjs';
import {signIn,OWNER_EMAIL,COOKIE_NAME,emptyDataset} from '../lib/auth-core.mjs';
import {memoryObjects} from './cloud-objects.mjs';
export async function cloudStore(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const directory=new URL('../drizzle/',import.meta.url);for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(name,directory),'utf8'));
 const db=sqliteAdapter(sqlite),objects=memoryObjects(),session=await signIn(db,{sub:'snapshot-test',email:OWNER_EMAIL,name:'Snapshot',email_verified:true});
 sqlite.prepare('INSERT INTO trade_account_snapshots(account_id,account_name,dataset_json,version,updated_at,owner_user_id) VALUES(?,?,?,?,?,?)').run('test','test',JSON.stringify(emptyDataset()),0,new Date().toISOString(),session.userId);
 const api=createAccountApi({db,objects,clientId:'fixture'});
 const request=(method,body)=>new Request('https://test.example/api/trade-records'+(method==='GET'?'?accountId=test':''),{method,headers:{Origin:'https://test.example',Cookie:`${COOKIE_NAME}=${session.token}`,'x-workspace-session':session.sessionId,'Content-Type':'application/json'},...(body?{body:JSON.stringify({...body,baseVersion:body.baseVersion??0})}:{})});
 const read=async()=>{const response=await api.handle(request('GET'));const body=await response.json();if(!response.ok)throw Error(body.error);return body;};
 const save=async payload=>{const response=await api.handle(request('PUT',payload));const body=await response.json();if(!response.ok)throw Object.assign(Error(body.error),{status:response.status});return body;};
 return {store:{read,save},sqlite,objects};
}
