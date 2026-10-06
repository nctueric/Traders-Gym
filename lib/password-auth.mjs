import { timingSafeEqual } from 'node:crypto';
import { authError, json, normalizeEmail, requireSameOrigin, requireSession, sessionCookie, sha256 } from './auth-core.mjs';

const encoder = new TextEncoder();
const SESSION_SECONDS = 12 * 60 * 60;
const WINDOW_MS = 15 * 60 * 1000;
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g), part => parseInt(part, 16));

export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(32))) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt }, key, 256);
  return `pbkdf2-sha256$100000$${hex(salt)}$${hex(derived)}`;
}

function requireHash(hash) {
  if (!/^pbkdf2-sha256\$100000\$[a-f0-9]{64}\$[a-f0-9]{64}$/.test(hash || '')) {
    throw authError('個人登入尚未設定完成', 503);
  }
}

export async function verifyPassword(password, hash) {
  requireHash(hash);
  const [, , salt, expected] = hash.split('$');
  const actual = (await hashPassword(password, unhex(salt))).split('$')[3];
  return timingSafeEqual(unhex(expected), unhex(actual));
}

async function readLoginBody(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw authError('請提供 JSON 格式', 415);
  if (!request.body) throw authError('請輸入帳號與密碼', 400);
  const reader = request.body.getReader();
  const parts = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw authError('登入資料過長', 413); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw authError('登入資料格式錯誤', 400); }
}

export function createPasswordAuth({ db, email, passwordHash }) {
  const configuredEmail = normalizeEmail(email);
  async function userId() { return `personal_${await sha256(configuredEmail)}`; }

  async function authenticate(request, options = {}) {
    requireHash(passwordHash);
    const user = await requireSession(db, request, { ...options, owner: false });
    if (user.authProvider !== 'password' || user.id !== await userId()) throw authError('此帳號不能使用個人試用模式', 403);
    if(await db.prepare('SELECT user_id FROM email_credentials WHERE user_id=?').bind(user.id).first()) throw authError('密碼已更新，請重新使用 Mail 登入',401);
    const proof = await db.prepare('SELECT fingerprint FROM password_session_credentials WHERE session_id=?').bind(user.sessionId).first();
    if (!proof || proof.fingerprint !== await sha256(passwordHash)) throw authError('登入已失效，請重新登入');
    return { ...user, email: configuredEmail, name: '個人測試帳號', isOwner: true, authProvider: 'password' };
  }

  async function login(request) {
    try {
      if (request.method !== 'POST') throw authError('不支援的登入操作', 405);
      requireSameOrigin(request);
      requireHash(passwordHash);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredEmail)) throw authError('個人登入尚未設定完成', 503);
      const now = Date.now(), window = Math.floor(now / WINDOW_MS) * WINDOW_MS;
      // Cloudflare supplies CF-Connecting-IP. Missing IP shares one restricted bucket.
      const ipKey = `ip:${await sha256(request.headers.get('cf-connecting-ip') || 'unknown')}`;
      const buckets = await db.batch(['global', ipKey].map(key => db.prepare(`
        INSERT INTO password_login_limits(key,window_start,attempts) VALUES(?,?,1)
        ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END,
        window_start=excluded.window_start RETURNING attempts`).bind(key, window)));
      if (buckets[0].results[0].attempts > 100 || buckets[1].results[0].attempts > 10) {
        return json({ error: '登入嘗試過多，請稍後再試' }, 429, { 'Retry-After': String(Math.ceil((window + WINDOW_MS - now) / 1000)) });
      }
      await db.prepare('DELETE FROM password_login_limits WHERE window_start<?').bind(now - 86400000).run();
      const body = await readLoginBody(request);
      if (!body || typeof body.email !== 'string' || typeof body.password !== 'string' || body.email.length > 254 || body.password.length > 256) throw authError('帳號或密碼不正確', 401);
      // Always run the same password verification for a syntactically valid attempt.
      const matches = await verifyPassword(body.password, passwordHash);
      if (!matches || normalizeEmail(body.email) !== configuredEmail) throw authError('帳號或密碼不正確', 401);
      const id = await userId(), sessionId = crypto.randomUUID();
      const token = hex(crypto.getRandomValues(new Uint8Array(32)));
      const createdAt = new Date(now).toISOString(), expiresAt = new Date(now + SESSION_SECONDS * 1000).toISOString();
      await db.batch([
        db.prepare(`INSERT INTO app_users(id,google_sub,email,name,picture,status,created_at,last_login_at)
          VALUES(?,?,?,'個人測試帳號','','ACTIVE',?,?) ON CONFLICT(id) DO UPDATE SET last_login_at=excluded.last_login_at`)
          .bind(id, `personal-password:${id}`, `${id}@personal-trial.invalid`, createdAt, createdAt),
        db.prepare(`INSERT INTO auth_sessions(id,token_hash,user_id,created_at,expires_at,provider)
          SELECT ?,?,id,?,?,'password' FROM app_users WHERE id=? AND status='ACTIVE'`).bind(sessionId, await sha256(token), createdAt, expiresAt, id),
        db.prepare(`INSERT INTO password_session_credentials(session_id,fingerprint)
          SELECT id,? FROM auth_sessions WHERE id=?`).bind(await sha256(passwordHash), sessionId),
        db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(createdAt),
      ]);
      if (!await db.prepare('SELECT id FROM auth_sessions WHERE id=?').bind(sessionId).first()) throw authError('此測試帳號已停用', 403);
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, request, SESSION_SECONDS) });
    } catch (error) {
      return json({ error: error.status ? error.message : '登入服務暫時無法使用' }, error.status || 503);
    }
  }
  async function reauthenticate(request) {
    const user = await authenticate(request, { mutation: true });
    const key = `reauth:${user.id}`, window = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
    const result = await db.prepare(`INSERT INTO password_login_limits(key,window_start,attempts) VALUES(?,?,1)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END,
      window_start=excluded.window_start RETURNING attempts`).bind(key, window).first();
    if (result.attempts > 10) throw authError('密碼確認次數過多，請 15 分鐘後重試', 429);
    const body = await readLoginBody(request);
    if (typeof body.password !== 'string' || body.password.length > 256 || !await verifyPassword(body.password, passwordHash)) throw authError('密碼不正確', 400);
    return user;
  }
  return { login, authenticate, reauthenticate };
}
