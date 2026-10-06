import { reauthenticateMember } from './email-auth.mjs';
import { authError, cookieValue, json, normalizeEmail, OWNER_EMAIL, requireSameOrigin, sessionCookie, sha256, signIn } from './auth-core.mjs';

export const APPLICATION_COOKIE = 'tg_application';
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
const identityKey = identity => identity.identity_key || (identity.google_sub ? `google:${identity.google_sub}` : `email:${normalizeEmail(identity.email)}`);
const instant = () => new Date().toISOString();
export const appCookie = (value, request, seconds = 1800) => sessionCookie(value, request, seconds).replace('tg_session=', `${APPLICATION_COOKIE}=`);
const redirect = (location, cookies = []) => {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
};
export async function bodyOf(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw authError('請提供 JSON 格式', 415);
  const reader = request.body?.getReader(); if (!reader) throw authError('缺少表單內容', 400);
  let size = 0; const parts = [];
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 20000) { await reader.cancel(); throw authError('內容過長', 413); } parts.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw authError('表單格式錯誤', 400); }
}
const publicApplication = row => row ? ({ id: row.id, explanation: row.explanation, status: row.status, revision: row.revision, submittedAt: row.submitted_at, updatedAt: row.updated_at, reviewNote: row.review_note, reviewedAt: row.reviewed_at }) : null;

export function createAccessApplications({ db, clientId, verifyCredential, authenticate, password = null, ownerEmail = '', applicationsOpen = false, openGoogleLogin = false }) {
  async function limit(request, subject, max = 10) {
    const window = Math.floor(Date.now() / 600000) * 600000;
    for (const [key, cap] of [[`application:${subject}`, max], [`application-ip:${await sha256(request.headers.get('cf-connecting-ip') || 'local')}`, 100]]) {
      const row = await db.prepare(`INSERT INTO password_login_limits(key,window_start,attempts) VALUES(?,?,1)
        ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END,
        window_start=excluded.window_start RETURNING attempts`).bind(key, window).first();
      if (row.attempts > cap) throw authError('操作次數過多，請 10 分鐘後重試', 429);
    }
  }
  async function applicationUser(request, mutation = false) {
    const value = cookieValue(request, APPLICATION_COOKIE);
    if (!/^[a-f0-9]{64}$/.test(value)) throw authError('請重新驗證身分', 401);
    const row = await db.prepare('SELECT * FROM application_sessions WHERE token_hash=? AND expires_at>?').bind(await sha256(value), instant()).first();
    if (!row) throw authError('身分驗證已到期，請重新驗證；已提交的申請仍會保留', 401);
    if (mutation) { requireSameOrigin(request); if (request.headers.get('x-application-session') !== row.id) throw authError('申請身分已變更，請重新整理', 403); }
    return row;
  }
  async function state(identity) {
    const user = await db.prepare('SELECT id,status,google_sub FROM app_users WHERE google_sub=? OR email=? ORDER BY google_sub=? DESC LIMIT 1').bind(identity.google_sub, identity.email, identity.google_sub).first();
    if (user && (identity.google_sub ? user.google_sub !== identity.google_sub : Boolean(user.google_sub))) return 'CONFLICT';
    if (user) return user.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED';
    const invite = await db.prepare('SELECT status,google_sub,identity_key FROM account_invites WHERE email=?').bind(identity.email).first();
    if ((invite?.identity_key && invite.identity_key !== identityKey(identity)) || (invite?.google_sub && invite.google_sub !== identity.google_sub)) return 'CONFLICT';
    if (invite?.status === 'REVOKED') return 'REVOKED';
    if (invite?.status === 'PENDING') return 'APPROVED';
    return 'NONE';
  }
  async function ready() {
    return applicationsOpen && !!await db.prepare("SELECT user_id FROM system_owner WHERE id=1 AND google_sub NOT LIKE 'personal-password:%'").first();
  }
  async function restricted(request, claims) {
    const value = token(), id = crypto.randomUUID();
    await db.batch([
      db.prepare('DELETE FROM application_sessions WHERE expires_at<=? OR token_hash=?').bind(instant(), await sha256(cookieValue(request, APPLICATION_COOKIE))),
      db.prepare('INSERT INTO application_sessions(id,token_hash,google_sub,email,name,expires_at,identity_key) VALUES(?,?,?,?,?,?,?)').bind(id, await sha256(value), claims.sub, normalizeEmail(claims.email), String(claims.name || claims.email).slice(0, 200), new Date(Date.now() + 1800000).toISOString(), identityKey({google_sub:claims.sub,email:claims.email})),
      db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await sha256(cookieValue(request, 'tg_session'))),
    ]);
    return redirect('/apply', [sessionCookie('', request, 0), appCookie(value, request)]);
  }
  async function google(request, claims) {
    const identity = { google_sub: claims.sub, email: normalizeEmail(claims.email) };
    await limit(request, `google:${claims.sub}`, 30);
    const access = await state(identity);
    if (identity.email === normalizeEmail(ownerEmail) && access !== 'ACTIVE') return redirect('/login?error=link_required');
    if ((openGoogleLogin && access === 'NONE') || access === 'ACTIVE' || access === 'APPROVED' || (!ownerEmail && identity.email === OWNER_EMAIL && access === 'NONE')) {
      const session = await signIn(db, claims, { reserveOwnerEmail: ownerEmail, openGoogleLogin });
      return redirect('/', [sessionCookie(session.token, request), appCookie('', request, 0)]);
    }
    return restricted(request, claims);
  }
  async function applicant(request) {
    const user = await applicationUser(request, request.method === 'POST');
    const current = await db.prepare('SELECT * FROM access_applications WHERE identity_key=?').bind(identityKey(user)).first();
    const access = await state(user), open = await ready();
    if (request.method === 'GET') return json({ identity: { name: user.name, email: user.email, provider: user.google_sub ? 'google' : 'email' }, sessionId: user.id, application: publicApplication(current), access, applicationsOpen: open });
    if (request.method !== 'POST') throw authError('不支援的操作', 405);
    const body = await bodyOf(request);
    if (body.action === 'logout') {
      await db.prepare('DELETE FROM application_sessions WHERE id=?').bind(user.id).run();
      return json({ ok: true }, 200, { 'Set-Cookie': appCookie('', request, 0) });
    }
    if (body.action === 'enter') {
      if (!['ACTIVE', 'APPROVED'].includes(access)) throw authError('目前尚無使用權限', 403);
      if (!user.google_sub) return emailEnter(request,user);
      const session = await signIn(db, { sub: user.google_sub, email: user.email, name: user.name }, { reserveOwnerEmail: ownerEmail, openGoogleLogin });
      await db.prepare('DELETE FROM application_sessions WHERE id=?').bind(user.id).run();
      const headers = new Headers({ 'Set-Cookie': sessionCookie(session.token, request) }); headers.append('Set-Cookie', appCookie('', request, 0));
      return json({ ok: true }, 200, headers);
    }
    if (!open) throw authError('申請尚未開放，請稍後再試', 403);
    if (access !== 'NONE' || current?.status === 'APPROVED') throw authError('目前狀態不能重新申請，請聯絡管理者', 403);
    const explanation = typeof body.explanation === 'string' ? body.explanation.trim() : '';
    if ([...explanation].length < 20 || [...explanation].length > 2000) throw authError('申請說明請填寫 20–2,000 字', 400);
    if (!Number.isInteger(body.revision) || body.revision !== (current?.revision || 0)) throw authError('申請已更新，請重新整理後確認內容', 409);
    await limit(request, `submit:${identityKey(user)}`);
    const other = await db.prepare('SELECT id FROM access_applications WHERE email=? AND identity_key<>?').bind(user.email,identityKey(user)).first();
    if (other) throw authError('此信箱已有其他登入方式的申請，請使用原申請方式查詢',409);
    const now = instant(), id = current?.id || crypto.randomUUID(), event = crypto.randomUUID();
    const result = await db.batch([
      db.prepare(`INSERT INTO access_applications(id,google_sub,email,name,explanation,status,revision,submitted_at,updated_at,review_note,event_id,identity_key)
        SELECT ?,?,?,?,?,'PENDING',1,?,?,'',?,? WHERE NOT EXISTS(SELECT 1 FROM access_applications WHERE email=? AND identity_key<>?) ON CONFLICT(identity_key) DO UPDATE SET
        email=excluded.email,name=excluded.name,explanation=excluded.explanation,status='PENDING',revision=revision+1,
        submitted_at=CASE WHEN status='REJECTED' THEN excluded.submitted_at ELSE submitted_at END,updated_at=excluded.updated_at,review_note='',reviewed_by=NULL,reviewed_at=NULL,event_id=excluded.event_id
        WHERE revision=? AND status IN ('PENDING','REJECTED') RETURNING id`).bind(id, user.google_sub, user.email, user.name, explanation, now, now, event, identityKey(user), user.email, identityKey(user), body.revision),
      db.prepare(`INSERT INTO access_application_history(id,application_id,revision,action,explanation,note,actor_id,created_at)
        SELECT event_id,id,revision,'SUBMITTED',explanation,'',identity_key,updated_at FROM access_applications WHERE event_id=?`).bind(event),
    ]);
    if (!result[0].results.length) throw authError('申請已更新，請重新整理後確認', 409);
    return json({ ok: true, application: publicApplication(await db.prepare('SELECT * FROM access_applications WHERE id=?').bind(id).first()) });
  }
  async function admin(request) {
    const user = await authenticate(request, { owner: true, mutation: request.method !== 'GET' });
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 254), filter = url.searchParams.get('status') || '', page = Math.max(0, Math.min(10000, Math.floor(Number(url.searchParams.get('page')) || 0)));
      if (filter && !['PENDING', 'APPROVED', 'REJECTED'].includes(filter)) throw authError('狀態無效', 400);
      if (url.searchParams.has('id')) {
        const application = await db.prepare('SELECT * FROM access_applications WHERE id=?').bind(url.searchParams.get('id')).first();
        if (!application) throw authError('找不到申請', 404);
        const history = await db.prepare('SELECT revision,action,explanation,note,created_at AS createdAt FROM access_application_history WHERE application_id=? ORDER BY revision DESC').bind(application.id).all();
        return json({ application: { ...publicApplication(application), email: application.email, name: application.name, access: await state(application) }, history: history.results });
      }
      const rows = await db.prepare(`SELECT * FROM access_applications WHERE (?='' OR status=?) AND (instr(lower(email),lower(?))>0 OR instr(lower(name),lower(?))>0)
        ORDER BY CASE WHEN status='PENDING' THEN 0 ELSE 1 END,submitted_at,id LIMIT 51 OFFSET ?`).bind(filter, filter, q, q, page * 50).all();
      const count = await db.prepare("SELECT COUNT(*) AS count FROM access_applications WHERE status='PENDING'").first();
      return json({ applications: rows.results.slice(0, 50).map(row => ({ ...publicApplication(row), email: row.email, name: row.name })), pendingCount: count.count, hasMore: rows.results.length > 50 });
    }
    if (request.method !== 'POST') throw authError('不支援的操作', 405);
    const body = await bodyOf(request), note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!['APPROVED', 'REJECTED'].includes(body.decision) || !Number.isInteger(body.revision) || note.length > 2000 || (body.decision === 'REJECTED' && !note)) throw authError('請確認審核結果；不通過時需填寫原因', 400);
    const current = await db.prepare('SELECT * FROM access_applications WHERE id=?').bind(String(body.id || '')).first();
    if (!current || current.status !== 'PENDING' || current.revision !== body.revision) throw authError('申請已變更或已審核，請重新開啟最新內容', 409);
    if (await state(current) !== 'NONE') throw authError('此帳號權限已變更，請先查看帳號管理', 409);
    const event = crypto.randomUUID(), now = instant();
    const grant = body.decision === 'APPROVED' ? [db.prepare(`INSERT INTO account_invites(email,status,created_by,created_at,google_sub,identity_key)
      SELECT email,'PENDING',?,?,google_sub,identity_key FROM access_applications WHERE event_id=?`).bind(user.id, now, event)] : [];
    const result = await db.batch([
      db.prepare(`UPDATE access_applications SET status=?,revision=revision+1,review_note=?,reviewed_by=?,reviewed_at=?,updated_at=?,event_id=?
        WHERE id=? AND revision=? AND status='PENDING' AND NOT EXISTS(SELECT 1 FROM account_invites i WHERE i.email=access_applications.email)
        AND NOT EXISTS(SELECT 1 FROM app_users u WHERE u.email=access_applications.email OR u.google_sub=access_applications.google_sub)
        AND EXISTS(SELECT 1 FROM auth_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? AND u.status='ACTIVE') RETURNING id`)
        .bind(body.decision, note, user.id, now, now, event, current.id, body.revision, user.sessionId, now),
      ...grant,
      db.prepare(`INSERT INTO access_application_history(id,application_id,revision,action,explanation,note,actor_id,created_at)
        SELECT event_id,id,revision,status,explanation,review_note,reviewed_by,updated_at FROM access_applications WHERE event_id=?`).bind(event),
      db.prepare(`INSERT INTO account_admin_events(id,actor_id,action,target_email,result,created_at)
        SELECT event_id,reviewed_by,CASE WHEN status='APPROVED' THEN 'approve_application' ELSE 'reject_application' END,email,'SUCCESS',updated_at FROM access_applications WHERE event_id=?`).bind(event),
    ]);
    if (!result[0].results.length) throw authError('申請或帳號權限已變更，請重新整理', 409);
    return json({ ok: true });
  }
  async function link(request) {
    const user = await authenticate(request, { mutation: request.method !== 'GET' });
    const identity = await db.prepare('SELECT google_sub FROM app_users WHERE id=?').bind(user.id).first();
    const linked = Boolean(identity.google_sub && !identity.google_sub.startsWith('personal-password:'));
    if (request.method === 'GET') return json({ linked, available: !!clientId && (user.authProvider==='email' || !!password), email: user.isOwner ? ownerEmail : user.email });
    if (request.method !== 'POST' || !['password','email'].includes(user.authProvider)) throw authError('請先使用 Mail 登入，再連結 Google', 403);
    if (!clientId) throw authError('Google 登入尚未設定', 503);
    if (linked) throw authError('此帳號已連結 Google，不需重複操作', 409);
    const action = new URL(request.url).searchParams.get('action');
    if (action === 'start') {
      if(user.authProvider==='password') await password.reauthenticate(request); else await reauthenticateMember(db,request,user);
      const value = token();
      await db.batch([
        db.prepare('DELETE FROM google_link_challenges WHERE user_id=? OR expires_at<=?').bind(user.id, instant()),
        db.prepare('INSERT INTO google_link_challenges(token_hash,session_id,user_id,expires_at) VALUES(?,?,?,?)').bind(await sha256(value), user.sessionId, user.id, new Date(Date.now() + 300000).toISOString()),
      ]);
      return json({ challenge: value });
    }
    const body = await bodyOf(request); await limit(request, `link:${user.id}`);
    if (typeof body.challenge !== 'string' || !/^[a-f0-9]{64}$/.test(body.challenge)) throw authError('連結驗證已失效，請重新確認密碼', 400);
    const hash = await sha256(body.challenge), now = instant();
    const challenge = await db.prepare('SELECT * FROM google_link_challenges WHERE token_hash=? AND user_id=? AND session_id=? AND consumed_at IS NULL AND expires_at>?').bind(hash, user.id, user.sessionId, now).first();
    if (!challenge) throw authError('連結驗證已失效，請重新確認密碼', 409);
    let claims; try { claims = await verifyCredential(String(body.credential || ''), clientId); } catch { throw authError('Google 驗證失敗，請重試', 400); }
    if (claims.nonce !== body.challenge || normalizeEmail(claims.email) !== normalizeEmail(user.isOwner ? ownerEmail : user.email)) throw authError('請選擇與目前帳號信箱相同的 Google 帳號', 403);
    const conflict = await db.prepare('SELECT id FROM app_users WHERE (google_sub=? OR email=?) AND id<>?').bind(claims.sub, normalizeEmail(claims.email), user.id).first();
    const owner = await db.prepare('SELECT user_id,google_sub FROM system_owner WHERE id=1').first();
    if (conflict || (user.isOwner && owner && (owner.user_id !== user.id || owner.google_sub !== claims.sub))) throw authError('Google 身分已連結其他帳號，未移動任何帳本', 409);
    const result = await db.batch([
      db.prepare(`UPDATE app_users SET google_sub=?,email=?,name=? WHERE id=? AND status='ACTIVE' AND (google_sub IS NULL OR google_sub LIKE 'personal-password:%')
        AND EXISTS(SELECT 1 FROM google_link_challenges c JOIN auth_sessions s ON s.id=c.session_id WHERE c.token_hash=? AND c.consumed_at IS NULL AND c.expires_at>? AND s.expires_at>?)
        AND (?=0 OR NOT EXISTS(SELECT 1 FROM system_owner WHERE user_id<>? OR google_sub<>?)) RETURNING id`)
        .bind(claims.sub, normalizeEmail(claims.email), String(claims.name || claims.email).slice(0, 200), user.id, hash, now, now, user.isOwner?1:0, user.id, claims.sub),
      ...(user.isOwner ? [db.prepare(`INSERT INTO system_owner(id,user_id,google_sub) SELECT 1,id,google_sub FROM app_users WHERE id=? AND google_sub=? ON CONFLICT(id) DO NOTHING`).bind(user.id, claims.sub)] : []),
      db.prepare(`UPDATE google_link_challenges SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND google_sub=?)`).bind(now, hash, user.id, claims.sub),
    ]);
    if (!result[0].results.length) throw authError('連結狀態已變更，請重新整理', 409);
    return json({ ok: true, linked: true });
  }
  let emailEnter = () => { throw authError('Mail 登入尚未設定',503); };
  return { google, applicant, admin, link, state, restricted, setEmailEnter: value => {emailEnter=value;} };
}
