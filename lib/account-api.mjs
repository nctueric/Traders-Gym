import {createPreferencesApi} from './member-preferences.mjs';
import { createMemberLedgers } from './member-ledgers.mjs';
import { createEmailAuth } from './email-auth.mjs';
import { createAccessApplications } from "./access-applications.mjs";
import { decodeSnapshotRequest } from "./snapshot-transport.mjs";
import { createHistoryApi } from "./snapshot-history.mjs";
import { OWNER_EMAIL, authError, emptyDataset, json, normalizeEmail, requireSession, sessionCookie, sha256, signIn, verifyGoogleCredential, verifyGoogleCsrf } from "./auth-core.mjs";
import { validateTradeRecordPayload } from "./trade-record-store.mjs";

const metadata = row => ({ id: row.account_id, name: row.account_name, version: row.version, updatedAt: row.updated_at });
/** @param {{ db: any, clientId: string, files?: any, objects?: any, verifyCredential?: typeof verifyGoogleCredential, authenticate?: any, trial?: boolean, accessOptions?: any, retentionEnabled?: boolean }} options */
export function createAccountApi({ db, clientId, files: legacyFiles = null, objects = null, verifyCredential = verifyGoogleCredential, authenticate = (request, options) => requireSession(db, request, options), trial = false, accessOptions = null, retentionEnabled = false }) {
  if (legacyFiles) throw authError("本機帳本模式已停用，請匯出舊資料後匯入雲端", 503);
  const access = accessOptions ? createAccessApplications({ db, clientId, verifyCredential, authenticate, ...accessOptions }) : null;
  const emailAuth=access ? createEmailAuth({db,authenticate,access,...accessOptions}) : null;
  access?.setEmailEnter(emailAuth.enter);
  async function snapshot(user, requested = null) {
    // Only the immutable owner binding may claim the legacy primary snapshot.
    if (user.isOwner && !trial && user.authProvider !== 'password') {
      await db.prepare(`UPDATE trade_account_snapshots SET owner_user_id = ? WHERE account_id = 'primary' AND owner_user_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM trade_account_snapshots WHERE owner_user_id = ?)` ).bind(user.id, user.id).run();
    }
    const initial = emptyDataset(), initialJson = JSON.stringify(initial), id = `user_${user.id}`;
    await db.prepare(`INSERT INTO trade_account_snapshots(account_id, account_name, dataset_json, version, updated_at, owner_user_id, save_mode, size_bytes)
      SELECT ?, ?, ?, 1, ?, ?, 'initial', ? WHERE NOT EXISTS (SELECT 1 FROM trade_account_snapshots WHERE owner_user_id=?) ON CONFLICT(account_id) DO NOTHING`).bind(id, initial.profile.name, initialJson, new Date().toISOString(), user.id, initialJson.length,user.id).run();
    const row = requested
      ? await db.prepare("SELECT * FROM trade_account_snapshots WHERE owner_user_id=? AND account_id=? AND deleted_at IS NULL").bind(user.id,requested).first()
      : await db.prepare("SELECT * FROM trade_account_snapshots WHERE owner_user_id=? AND deleted_at IS NULL ORDER BY account_id=COALESCE((SELECT active_account_id FROM member_preferences WHERE user_id=owner_user_id),'') DESC,updated_at DESC,account_id LIMIT 1").bind(user.id).first();
    if (!row) {
      if(!requested) return {account:null,dataset:null};
      const deleted=await db.prepare('SELECT deleted_at FROM trade_account_snapshots WHERE owner_user_id=? AND account_id=?').bind(user.id,requested).first();
      throw authError(deleted?.deleted_at?'帳本已移至回收筒，請先還原':'無法存取此交易帳本',deleted?.deleted_at?410:403);
    }
      let serialized = row.dataset_json;
      if (row.object_key) {
        if (!objects) throw authError("完整快照儲存尚未設定，請聯絡管理者", 503);
        const object = await objects.get(row.object_key);
        if (!object) throw authError("找不到完整快照，已停止寫入，請檢查備份", 503);
        serialized = await object.text();
        if (object.customMetadata?.sha256 !== await sha256(serialized)) throw authError("完整快照未通過校驗，請檢查備份", 503);
      }
      return { account: metadata(row), dataset: JSON.parse(serialized) };
  }
  const preferences=createPreferencesApi({db,authenticate});
  const ledgers = createMemberLedgers({db,authenticate});
  const history = createHistoryApi({ db, objects, retentionEnabled, authenticate: request => authenticate(request, { owner: true, mutation: true }), restore: request => execute(request) });
  async function admin(request, user, path) {
    if (path === '/api/admin/ledgers' && request.method === 'POST') {
      if(user.authProvider!=='password') throw authError('目前僅支援個人雲端帳本匯入',403);
      const id=`history_${(await sha256(user.id)).slice(0,40)}`;
      if(await db.prepare('SELECT account_id FROM trade_account_snapshots WHERE account_id=?').bind(id).first()) throw authError('標準歷史帳本已存在，未覆蓋',409);
      const body=await request.json();
      const checked=validateTradeRecordPayload({accountId:id,accountName:'標準歷史帳本',dataset:body.dataset,baseVersion:0},{maxBytes:50_000_000});
      if(!checked.ok) throw authError(checked.error,400);
      if(!objects) throw authError('完整快照儲存尚未設定',503);
      await authenticate(request,{owner:true,mutation:true});
      const key=`snapshots/${user.id}/${crypto.randomUUID()}.json`,now=new Date().toISOString();
      const hash=await sha256(checked.datasetJson),size=new TextEncoder().encode(checked.datasetJson).length;
      if(await objects.put(key,checked.datasetJson,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:hash}})===null) throw authError('帳本尚未儲存成功',503);
      const inserted=await db.prepare(`INSERT INTO trade_account_snapshots(account_id,account_name,dataset_json,version,updated_at,owner_user_id,save_mode,size_bytes,object_key)
        SELECT ?,'標準歷史帳本','{}',1,?,?,'import',?,? WHERE EXISTS(SELECT 1 FROM auth_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND u.status='ACTIVE' AND s.expires_at>?)
        ON CONFLICT(account_id) DO NOTHING RETURNING account_id,account_name,version,updated_at`).bind(id,now,user.id,size,key,user.sessionId,user.id,now).first();
      if(!inserted) throw authError('匯入未完成或帳本已存在，未覆蓋',409);
      await db.prepare(`INSERT OR IGNORE INTO snapshot_history(owner_user_id,account_id,account_name,version,created_at,dataset_json,object_key,size_bytes,pinned)
        VALUES(?,?,'標準歷史帳本',1,?,'{}',?,?,1)`).bind(user.id,id,now,key,size).run();
      return json({account:metadata(inserted),sha256:hash,sizeBytes:size},201);
    }
    if (path === '/api/admin/ledgers' && request.method === 'GET') {
      const rows=await db.prepare('SELECT account_id,account_name,version,updated_at FROM trade_account_snapshots WHERE owner_user_id=? AND deleted_at IS NULL ORDER BY account_name').bind(user.id).all();
      return json({accounts:rows.results.map(metadata)});
    }
    if (path === "/api/admin/history") return history(request, user);
    if (trial) throw authError("私人試用僅開放自己的歷史版本；Google 帳號管理驗收暫停",403);
    if (request.method === "GET") {
      if (path === "/api/admin/events") {
        const url = new URL(request.url), page = Math.max(0, Math.min(10000, Number(url.searchParams.get("page")) || 0));
        const q = (url.searchParams.get("q") || "").slice(0, 254), action = url.searchParams.get("action") || "";
        const rows = await db.prepare("SELECT action, target_email AS email, result, created_at AS createdAt FROM account_admin_events WHERE instr(lower(target_email), lower(?)) > 0 AND (? = '' OR action = ?) ORDER BY created_at DESC, id DESC LIMIT 51 OFFSET ?").bind(q, action, action, Math.floor(page) * 50).all();
        return json({ events: rows.results.slice(0, 50), hasMore: rows.results.length > 50 });
      }
      if (path !== "/api/admin/accounts") return json({ error: "找不到管理操作" }, 404);
      const accounts = await db.prepare(`SELECT u.id, u.email, u.name, u.status, u.last_login_at AS lastLoginAt,
        CASE WHEN o.user_id = u.id THEN 1 ELSE 0 END AS isOwner,
        (SELECT COUNT(*) FROM auth_sessions a WHERE a.user_id=u.id AND a.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS activeSessions,
        s.account_id AS ledgerId, s.account_name AS ledgerName, s.deleted_at AS deletedAt,
        s.version, s.updated_at AS updatedAt, s.save_mode AS saveMode, COALESCE(s.size_bytes, length(CAST(s.dataset_json AS BLOB))) AS sizeBytes
        FROM app_users u LEFT JOIN system_owner o ON o.id = 1 LEFT JOIN trade_account_snapshots s ON s.owner_user_id = u.id ORDER BY u.created_at DESC, s.updated_at DESC`).all();
      const invites = await db.prepare("SELECT email, status, created_at AS createdAt FROM account_invites WHERE status != 'ACCEPTED' ORDER BY created_at DESC").all();
      const grouped = new Map();
      for (const row of accounts.results) {
        if (!grouped.has(row.id)) grouped.set(row.id, { ...row, ledgerCount: 0, deletedLedgerCount: 0, ledgers: [] });
        const account = grouped.get(row.id);
        if (row.ledgerId) {
          account[row.deletedAt ? 'deletedLedgerCount' : 'ledgerCount']++;
          account.ledgers.push({ id: row.ledgerId, name: row.ledgerName, version: row.version, updatedAt: row.updatedAt, deletedAt: row.deletedAt, sizeBytes: row.sizeBytes, saveMode: row.saveMode });
        }
      }
      return json({ accounts: [...grouped.values()], invites: invites.results });
    }
    if (request.method !== "POST" || path !== "/api/admin/accounts") return json({ error: "不支援的管理操作" }, 405);
    const body = await request.json(), email = normalizeEmail(body.email), action = body.action;
    const allowed = ["invite", "revoke_invite", "disable", "enable", "revoke_sessions"];
    if (!allowed.includes(action) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw authError("請確認操作與 Google email", 400);
    const target = await db.prepare("SELECT id, status FROM app_users WHERE email = ?").bind(email).first();
    const now = new Date().toISOString();
    const event = result => db.prepare("INSERT INTO account_admin_events(id, actor_id, action, target_email, result, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.id, action, email, result, now);
    if (email === OWNER_EMAIL || target?.id === user.id) {
      await event("DENIED").run();
      throw authError("系統擁有者不能被停用、移除或轉讓", 403);
    }
    let statements;
    if (action === "invite") {
      if (target) throw authError("此帳號已存在，請使用恢復或停用操作", 409);
      statements = [db.prepare(`INSERT INTO account_invites(email, status, created_by, created_at) VALUES (?, 'PENDING', ?, ?)
        ON CONFLICT(email) DO UPDATE SET status = 'PENDING', created_by = excluded.created_by, created_at = excluded.created_at WHERE status = 'REVOKED'`).bind(email, user.id, now)];
    } else if (action === "revoke_invite") {
      if (target) throw authError("此邀請已接受，請改用停用帳號", 409);
      statements = [db.prepare("UPDATE account_invites SET status = 'REVOKED' WHERE email = ? AND status = 'PENDING'").bind(email)];
    } else {
      if (!target) throw authError("找不到此帳號", 404);
      statements = action === "revoke_sessions" ? [] : [db.prepare("UPDATE app_users SET status = ? WHERE id = ? AND id NOT IN (SELECT user_id FROM system_owner)").bind(action === "disable" ? "DISABLED" : "ACTIVE", target.id)];
      statements.push(db.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND user_id NOT IN (SELECT user_id FROM system_owner)").bind(target.id));
    }
    await db.batch([...statements, event("SUCCESS")]);
    return json({ ok: true });
  }
  async function execute(request) {
    const path = new URL(request.url).pathname;
    try {
      if(path==='/api/preferences')return preferences(request);
      if(path==='/api/ledgers') return await ledgers(request);
      if (emailAuth && path === '/api/auth/email') return await emailAuth.handle(request);
      if (emailAuth && path === '/api/auth/password') return await emailAuth.login(request);
      if (access && path === '/api/auth/application') return await access.applicant(request);
      if (access && path === '/api/auth/google-link') return await access.link(request);
      if (access && path === '/api/admin/applications') return await access.admin(request);
      if (trial && path === "/api/auth/google") return json({ error: "Google 登入尚未啟用" },403);
      if (path === "/api/auth/google" && request.method === "POST") {
        if (Number(request.headers.get("content-length")) > 20000) throw authError("登入請求過大", 413);
        const text = await request.text();
        if (text.length > 20000) throw authError("登入請求過大", 413);
        const form = new URLSearchParams(text);
        verifyGoogleCsrf(request, form);
        let claims;
        try { claims = await verifyCredential(form.get("credential") || "", clientId); }
        catch (error) { throw authError(error.status ? error.message : "Google 登入驗證失敗，請重試", error.status || 401); }
        if (access) return await access.google(request, claims);
        const { token } = await signIn(db, claims);
        await db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(new Date().toISOString()).run();
        return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": sessionCookie(token, request), "Cache-Control": "no-store" } });
      }
      const mutation = !["GET", "HEAD"].includes(request.method);
      const user = await authenticate(request, { owner: path.startsWith("/api/admin/"), mutation });
      if (path === "/api/auth/session" && request.method === "GET") return json({ user });
      if (path === "/api/auth/logout" && request.method === "POST") {
        await db.prepare("DELETE FROM auth_sessions WHERE id = ?").bind(user.sessionId).run();
        return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", request, 0) });
      }
      if (path.startsWith("/api/admin/")) return await admin(request, user, path);
      if (path !== "/api/trade-records") return json({ error: "找不到操作" }, 404);
      if (request.method === 'PUT' && !request.headers.get('content-type')?.startsWith('application/json')) throw authError('請提供 JSON 格式',415);
      const body = request.method === 'PUT' ? await decodeSnapshotRequest(request) : null;
      const requested = new URL(request.url).searchParams.get("accountId") || body?.accountId;
      const current = await snapshot(user,requested);
      if (requested && requested !== current.account?.id) throw authError("無法存取此交易帳本", 403);
      if (request.method === "GET") {
        const rows=await db.prepare('SELECT account_id,account_name,version,updated_at FROM trade_account_snapshots WHERE owner_user_id=? AND deleted_at IS NULL ORDER BY account_name').bind(user.id).all();
        return json({ ...current, accounts: rows.results.map(metadata) });
      }
      if(!current.account) throw authError('沒有可儲存的帳本，請先建立或還原帳本',410);
      if (request.method !== "PUT") return json({ error: "不支援的操作" }, 405);
      if (!request.headers.get("content-type")?.startsWith("application/json")) throw authError("請提供 JSON 格式", 415);
      if (body.accountId && body.accountId !== current.account.id) throw authError("無法存取此交易帳本", 403);
      const checked = validateTradeRecordPayload({ ...body, accountId: current.account.id }, { maxBytes: objects ? 50_000_000 : 1_800_000 });
      if (!checked.ok) throw authError(checked.error, 400);
      if(current.dataset.marketSnapshot&&!checked.dataset.marketSnapshot)throw authError('此頁面使用舊版儲存格式；請重新載入完整雲端快照後再儲存',400);
      const saveMode = body.saveMode === "auto" ? "auto" : "manual";
      if (saveMode === "auto" && ((current.dataset.fills.length > 0 && checked.dataset.fills.length === 0)
        || ((current.dataset.cashActivities || []).length > 0 && (checked.dataset.cashActivities || []).length === 0))) {
        throw authError("已攔截會清空帳本的背景儲存；請重新整理並載入雲端帳本", 409);
      }
      if (checked.baseVersion !== current.account.version) throw authError("資料版本不一致；請先保留當頁資料匯出再確認版本", 409);
      // Recheck after parsing a large body: revocation must take effect before any write.
      await authenticate(request, { mutation: true });
      const sizeBytes = new TextEncoder().encode(checked.datasetJson).length;
      if (!objects) throw authError("雲端快照儲存尚未設定",503);
      const objectKey = `snapshots/${user.id}/${crypto.randomUUID()}.json`;
      if (objectKey) {
        const stored = await objects.put(objectKey, checked.datasetJson, { httpMetadata: { contentType: "application/json" }, customMetadata: { sha256: await sha256(checked.datasetJson) } });
        if (stored === null) throw authError("完整快照尚未儲存成功，請重試", 503);
      }
      const saved = await db.prepare(`UPDATE trade_account_snapshots SET account_name = ?, dataset_json = ?, version = version + 1, updated_at = ?, save_mode = ?, size_bytes = ?, object_key = ?
        WHERE owner_user_id = ? AND account_id=? AND deleted_at IS NULL AND version = ? AND EXISTS (SELECT 1 FROM auth_sessions s JOIN app_users u ON u.id = s.user_id WHERE s.id = ? AND u.status = 'ACTIVE' AND s.expires_at > ?)
        RETURNING account_id, account_name, version, updated_at`).bind(checked.accountName, objectKey ? "{}" : checked.datasetJson, new Date().toISOString(), saveMode, sizeBytes, objectKey, user.id,current.account.id, checked.baseVersion ?? 0, user.sessionId, new Date().toISOString()).first();
      if (!saved) {
        await authenticate(request, { mutation: true });
        throw authError("資料版本不一致；請先保留當頁資料匯出再確認版本", 409);
      }
      return json({ account: metadata(saved) });
    } catch (error) {
      if (path === "/api/auth/google") {
        const code = error.status === 503 ? "setup" : error.status === 403 ? "denied" : "failed";
        return new Response(null, { status: 303, headers: { Location: `/login?error=${code}`, "Cache-Control": "no-store", "Set-Cookie": sessionCookie("", request, 0) } });
      }
      return json({ error: error.status ? error.message : "服務暫時無法完成操作，請稍後重試" }, error.status || 500);
    }
  }
  return { handle: execute, snapshot };
}
