import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {json,authError} from '../lib/auth-core.mjs';
// Never imports the old writer. Only stable identity ownership allows file export.
export async function legacyFileRows(request,{authenticate,directory}){
 let sqlite;
 try{
  const user=await authenticate(request);
  if(request.method!=='GET')throw authError('舊資料僅供唯讀匯出',405);
  try{sqlite=new DatabaseSync(join(directory,'accounts.sqlite'),{readOnly:true});}catch{return json({records:[]});}
  const identity=sqlite.prepare('SELECT id,google_sub FROM app_users WHERE id=?').get(user.id);
  if(!identity)return json({records:[]});
  const rows=sqlite.prepare('SELECT account_id,account_name FROM trade_account_snapshots WHERE owner_user_id=?').all(user.id),records=[];
  for(const row of rows){
   if(!/^[a-zA-Z0-9_-]{1,80}$/.test(row.account_id))continue;
   try{
    const {_storage,...dataset}=JSON.parse(await readFile(join(directory,'目前帳號',row.account_id+'.json'),'utf8'));
    if(_storage?.accountId!==row.account_id||_storage.sha256!==createHash('sha256').update(JSON.stringify(dataset)).digest('hex'))continue;
    records.push({id:row.account_id,name:row.account_name,version:_storage.version,updatedAt:_storage.updatedAt,dataset,source:'舊伺服器檔案'});
   }catch{/* An invalid file cannot be offered as a verified export. */}
  }
  return json({records});
 }catch(e){return json({error:e.status?e.message:'舊資料檢查失敗'},e.status||503);}finally{sqlite?.close();}
}
