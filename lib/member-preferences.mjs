import {authError,json} from './auth-core.mjs';
export const REVIEW_COLUMNS=['cycle','pnl','return','days','investment','allocation','expectancy','entry','exit','follow','mae','mfe','post','chart'];
export const DEFAULT_PREFERENCES={valuationCurrency:'USD',entryMode:'simple',onboardingDone:false,holdingsColorScheme:'green-up',reviewColumns:REVIEW_COLUMNS};
const validators={holdingsColorScheme:v=>['green-up','red-up'].includes(v),valuationCurrency:v=>['USD','TWD'].includes(v),entryMode:v=>['simple','full'].includes(v),onboardingDone:v=>typeof v==='boolean',reviewColumns:v=>Array.isArray(v)&&v.length===REVIEW_COLUMNS.length&&new Set(v).size===v.length&&v.every(x=>REVIEW_COLUMNS.includes(x))};
export function validatePreferencePatch(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||!Object.keys(body).length||Object.keys(body).some(k=>!validators[k]||!validators[k](body[k])))throw authError('偏好欄位或內容無效',400);
 return body;
}
export function createPreferencesApi({db,authenticate}){
 return async request=>{
  try{
   if(!['GET','PATCH'].includes(request.method))throw authError('不支援的操作',405);
   const user=await authenticate(request,{mutation:request.method==='PATCH'});
   if(new URL(request.url).search)throw authError('偏好只屬於目前登入會員',400);
   if(request.method==='PATCH'){
    if(!request.headers.get('content-type')?.startsWith('application/json'))throw authError('請提供 JSON 格式',415);
    const text=await request.text();if(text.length>4096)throw authError('偏好資料過大',413);
    let body;try{body=JSON.parse(text);}catch{throw authError('偏好 JSON 無效',400);}
    const patch=validatePreferencePatch(body);
    // json_patch runs atomically in D1; concurrent edits to different fields survive.
    await authenticate(request,{mutation:true});
    const saved=await db.prepare(`INSERT INTO member_preferences(user_id,preferences_json) SELECT ?,? WHERE EXISTS(SELECT 1 FROM auth_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND u.status='ACTIVE') ON CONFLICT(user_id) DO UPDATE SET preferences_json=json_patch(COALESCE(member_preferences.preferences_json,'{}'),excluded.preferences_json) RETURNING user_id`).bind(user.id,JSON.stringify(patch),user.sessionId,user.id,new Date().toISOString()).first();
    if(!saved)throw authError('登入已失效，偏好未儲存',401);
   }
   const row=await db.prepare('SELECT preferences_json FROM member_preferences WHERE user_id=?').bind(user.id).first();
   const saved=JSON.parse(row?.preferences_json||'{}');
   return json({preferences:{...DEFAULT_PREFERENCES,...saved},configured:Object.keys(saved)});
  }catch(e){return json({error:e.status?e.message:'偏好服務暫時無法使用'},e.status||503);}
 };
}
