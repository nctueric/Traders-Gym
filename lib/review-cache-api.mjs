import {authError,json,requireSameOrigin} from "./auth-core.mjs";
import {validReviewCache} from "./review-cache.mjs";
export async function reviewCacheHandler(request, {db, objects, authenticate}) {
  try {
    const user = await authenticate(request);
    if (request.method === "PUT") {
      requireSameOrigin(request);
      if (request.headers.get("x-workspace-session") !== user.sessionId) throw authError("登入已變更", 401);
    }
    const params = new URL(request.url).searchParams;
    const accountId = params.get("accountId") || "", key = params.get("key") || "";
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(accountId) || !/^[a-f0-9]{64}$/.test(key)) return json({error:"估值識別碼無效"},400);
    const owned = await db.prepare("SELECT account_id FROM trade_account_snapshots WHERE account_id=? AND owner_user_id=? AND deleted_at IS NULL AND archived_at IS NULL").bind(accountId,user.id).first();
    if (!owned) return json({error:"無法存取此帳本"},403);
    if (!objects) return json({error:"雲端估值儲存未設定"},503);
    // One replaceable derived object per owned ledger; never shares the snapshot prefix.
    const objectKey = `review-valuations/${encodeURIComponent(user.id)}/${accountId}.json`;
    if (request.method === "GET") {
      const object = await objects.get(objectKey);
      if (!object || object.customMetadata?.inputKey !== key) return json({cache:null});
      return new Response(object.body, {headers:{"Content-Type":"application/json","Cache-Control":"private, no-store"}});
    }
    const reader = request.body?.getReader();
    if (!reader) return json({error:"缺估值內容"},400);
    const chunks = []; let size = 0;
    while (true) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>4_000_000){await reader.cancel();return json({error:"估值快取過大"},413);} chunks.push(value); }
    const bytes = new Uint8Array(size); let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    let payload;try {payload=JSON.parse(new TextDecoder().decode(bytes));} catch {return json({error:"估值格式無效"},400);}
    if (!validReviewCache(payload,key)) return json({error:"估值格式無效"},400);
    await authenticate(request);
    if(!await db.prepare("SELECT account_id FROM trade_account_snapshots WHERE account_id=? AND owner_user_id=? AND deleted_at IS NULL AND archived_at IS NULL").bind(accountId,user.id).first()) return json({error:"帳本已移至回收筒"},410);
    await objects.put(objectKey, JSON.stringify(payload), {httpMetadata:{contentType:"application/json"},customMetadata:{inputKey:key}});
    return json({saved:true});
  } catch(error) {const e=error;return json({error:e.status?e.message:"雲端估值暫時無法使用"},e.status||503);}
}
