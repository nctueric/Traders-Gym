import { createRemoteJWKSet, jwtVerify } from "jose";

export const OWNER_EMAIL = "nctueric@gmail.com";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const COOKIE_NAME = "tg_session";
export const authError = (message, status = 401) => Object.assign(new Error(message), { status });
export const normalizeEmail = value => String(value || "").trim().toLowerCase();
export const emptyDataset = () => ({ version: "0.1.0", profile: { name: "我的交易帳本", baseCurrency: "USD", costMethod: "FIFO" }, accounts: [{ id: "main", name: "主要帳戶", currency: "USD" }], fills: [], cashActivities: [], marketBars: [], settings: { quoteProvider: "json", benchmarkSymbol: "SPY" }, positionPlans: {}, cycleReviews: {}, decisionLinks: {}, decisionLinkHistory: [], planHistory: [], improvementExperiments: [], strategies: [], strategyAssignments: {} });
export const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
export function cookieValue(request, name) {
  const matches = (request.headers.get("cookie") || "").split(";").map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : "";
}
export async function sha256(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), n => n.toString(16).padStart(2, "0")).join("");
}
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("");
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
export async function verifyGoogleCredential(credential, clientId, keySet = googleKeys) {
  if (!clientId) throw authError("Google 登入尚未設定完成", 503);
  const { payload } = await jwtVerify(credential, keySet, { algorithms: ["RS256"], audience: clientId, issuer: ["https://accounts.google.com", "accounts.google.com"], requiredClaims: ["sub", "email", "email_verified", "exp", "iat"] });
  if (payload.email_verified !== true || typeof payload.sub !== "string" || !payload.sub || typeof payload.email !== "string") throw authError("Google 帳號尚未驗證");
  // Gmail and Workspace email ownership is authoritative; third-party email identities need separate verification.
  if (!normalizeEmail(payload.email).endsWith("@gmail.com") && !payload.hd) throw authError("請使用 Gmail 或 Google Workspace 帳號登入", 403);
  return payload;
}
export function verifyGoogleCsrf(request, form) {
  const cookie = cookieValue(request, "g_csrf_token"), field = form.get("g_csrf_token");
  if (!cookie || cookie.length > 1024 || cookie !== field) throw authError("登入驗證已失效，請重新登入", 403);
}
export function requireSameOrigin(request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw authError("不允許其他網站執行此操作", 403);
}
export function sessionCookie(token, request, expires = SESSION_SECONDS) {
  const url = new URL(request.url);
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  return `${COOKIE_NAME}=${token}; HttpOnly; ${local ? "" : "Secure; "}SameSite=Lax; Path=/; Max-Age=${expires}`;
}
export async function requireSession(db, request, { owner = false, mutation = false } = {}) {
  const token = cookieValue(request, COOKIE_NAME);
  if (!/^[a-f0-9]{64}$/.test(token)) throw authError("請先登入");
  const row = await db.prepare(`SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.name, u.picture, u.status,
    CASE WHEN o.user_id = u.id THEN 1 ELSE 0 END AS is_owner
    FROM auth_sessions s JOIN app_users u ON u.id = s.user_id LEFT JOIN system_owner o ON o.id = 1
    WHERE s.token_hash = ? AND s.expires_at > ?`).bind(await sha256(token), new Date().toISOString()).first();
  if (!row) throw authError("登入已到期，請重新登入");
  if (row.status !== "ACTIVE") throw authError("此帳號已停用", 403);
  if (owner && !row.is_owner) throw authError("只有系統擁有者可以使用管理後台", 403);
  const expected = request.headers.get("x-workspace-session");
  if ((mutation || expected) && expected !== row.session_id) throw authError("登入帳號已變更，請重新開啟工作區", 401);
  if (mutation) requireSameOrigin(request);
  return { id: row.id, email: row.email, name: row.name, picture: row.picture, isOwner: !!row.is_owner, sessionId: row.session_id, expiresAt: row.expires_at };
}

// All registration statements run in one D1 transaction; a Google subject is never rebound by email.
export async function signIn(db, claims) {
  const email = normalizeEmail(claims.email), now = new Date().toISOString(), id = crypto.randomUUID();
  const existing = await db.prepare("SELECT id, status FROM app_users WHERE google_sub = ?").bind(claims.sub).first();
  if (existing?.status === "DISABLED") throw authError("此帳號已停用", 403);
  const owner = await db.prepare("SELECT google_sub FROM system_owner WHERE id = 1").first();
  const invite = await db.prepare("SELECT email FROM account_invites WHERE email = ? AND status = 'PENDING'").bind(email).first();
  const bootstrap = email === OWNER_EMAIL && (!owner || owner.google_sub === claims.sub);
  if (!existing && !invite && !bootstrap) throw authError("此帳號尚未受邀", 403);
  const token = randomToken(), sessionId = crypto.randomUUID(), expires = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await db.batch([
    db.prepare(`INSERT INTO app_users(id, google_sub, email, name, picture, status, created_at, last_login_at)
      SELECT ?, ?, ?, ?, ?, 'ACTIVE', ?, ? WHERE
      EXISTS (SELECT 1 FROM account_invites WHERE email = ? AND status = 'PENDING') OR
      (? = ? AND NOT EXISTS (SELECT 1 FROM system_owner WHERE id = 1))
      ON CONFLICT(google_sub) DO NOTHING`).bind(id, claims.sub, email, String(claims.name || email).slice(0, 200), String(claims.picture || "").slice(0, 1000), now, now, email, email, OWNER_EMAIL),
    db.prepare(`INSERT INTO system_owner(id, user_id, google_sub) SELECT 1, id, google_sub FROM app_users WHERE google_sub = ? AND email = ? ON CONFLICT(id) DO NOTHING`).bind(claims.sub, OWNER_EMAIL),
    db.prepare("UPDATE app_users SET name = ?, picture = ?, last_login_at = ? WHERE google_sub = ? AND status = 'ACTIVE'").bind(String(claims.name || email).slice(0, 200), String(claims.picture || "").slice(0, 1000), now, claims.sub),
    db.prepare("UPDATE account_invites SET status = 'ACCEPTED', accepted_at = ? WHERE email = ? AND status = 'PENDING' AND EXISTS (SELECT 1 FROM app_users WHERE google_sub = ? AND email = account_invites.email)").bind(now, email, claims.sub),
    db.prepare("INSERT INTO auth_sessions(id, token_hash, user_id, created_at, expires_at) SELECT ?, ?, id, ?, ? FROM app_users WHERE google_sub = ? AND status = 'ACTIVE'").bind(sessionId, await sha256(token), now, expires, claims.sub),
  ]);
  const session = await db.prepare("SELECT user_id FROM auth_sessions WHERE id = ?").bind(sessionId).first();
  if (!session) throw authError("邀請已失效，請聯絡管理者", 403);
  return { token, sessionId, userId: session.user_id };
}
