import { createResendMailer } from '@/lib/email-auth.mjs';
import { createMixedAuthenticator } from "@/lib/mixed-auth.mjs";
import { requireSitesTrialUser } from "@/lib/sites-trial-auth.mjs";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authError, json } from "@/lib/auth-core.mjs";
import { createAccountApi } from "@/lib/account-api.mjs";
import { createPasswordAuth } from "@/lib/password-auth.mjs";

function passwordAuth() {
  return createPasswordAuth({ db: env.DB, email: String(env.PERSONAL_LOGIN_EMAIL || ""), passwordHash: String(env.PERSONAL_PASSWORD_HASH || "") });
}

export type AccountUser = { id: string; email: string; name: string; picture: string; isOwner: boolean; sessionId: string; expiresAt: string; authProvider?: string };
export async function apiUser(request: Request, owner = false): Promise<AccountUser> {
  if (env.LOCAL_ACCOUNT_SERVICE === "true") {
    const host = request.headers.get("host") || new URL(request.url).host;
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw authError("本機網址無效", 403);
    const response = await fetch(`http://${host}/api/auth/session`, { headers: { cookie: request.headers.get("cookie") || "", "x-workspace-session": request.headers.get("x-workspace-session") || "" }, cache: "no-store" });
    const payload = await response.json() as { user?: AccountUser; error?: string };
    if (!response.ok || !payload.user) throw authError(payload.error || "請先登入", response.status);
    if (owner && !payload.user.isOwner) throw authError("只有系統擁有者可以使用管理後台", 403);
    return payload.user;
  }
  if (!env.DB) throw authError("帳號服務尚未設定", 503);
  if (env.SITES_TRIAL_AUTH === "true" && env.PERSONAL_PASSWORD_LOGIN !== "true") return requireSitesTrialUser(env.DB, request);
  return createMixedAuthenticator(env.DB, env.PERSONAL_PASSWORD_LOGIN === "true" ? passwordAuth() : null)(request, { owner });
}
export async function pageUser(owner = false) {
  const incoming = await headers();
  const request = new Request(`https://${incoming.get("host") || "localhost"}/`, { headers: incoming });
  try {
    if (env.SITES_TRIAL_AUTH === "true" && env.PERSONAL_PASSWORD_LOGIN !== "true" && env.LOCAL_ACCOUNT_SERVICE !== "true") return await requireSitesTrialUser(env.DB, request, { bootstrap: true });
    return await apiUser(request, owner);
  }
  catch (error) {
    if ((error as { status?: number }).status === 403 && owner) redirect("/forbidden");
    redirect("/login");
  }
}
export async function accountHandler(request: Request) {
  if (!env.DB || !env.SNAPSHOTS) return json({ error: "雲端 D1／R2 帳本儲存綁定尚未設定" }, 503);
  if (env.SITES_TRIAL_AUTH === "true" && env.PERSONAL_PASSWORD_LOGIN !== "true") return createAccountApi({ db: env.DB, objects: env.SNAPSHOTS, retentionEnabled: env.SNAPSHOT_RETENTION_ENABLED === "true", clientId: "", trial: true, authenticate: (request: Request, options: { mutation?: boolean }) => requireSitesTrialUser(env.DB, request, options) }).handle(request);
  const password = env.PERSONAL_PASSWORD_LOGIN === "true" ? passwordAuth() : null;
  return createAccountApi({ db: env.DB, objects: env.SNAPSHOTS, retentionEnabled: env.SNAPSHOT_RETENTION_ENABLED === "true", clientId: String(env.GOOGLE_CLIENT_ID || ""), authenticate: createMixedAuthenticator(env.DB, password),
    accessOptions: { openGoogleLogin: env.OPEN_GOOGLE_LOGIN === "true", password, sendMail:createResendMailer({apiKey:String(env.RESEND_API_KEY || ''),from:String(env.EMAIL_FROM || 'TraderGym <no-reply@tradergym.app>')}), origin:String(env.APP_ORIGIN || ''), ownerEmail: String(env.PERSONAL_LOGIN_EMAIL || ""), applicationsOpen: env.APPLICATIONS_OPEN === "true" } }).handle(request);
}
export async function rejectAnonymous(request: Request) {
  try { await apiUser(request); return null; }
  catch (error) { const failure = error as { status?: number; message?: string }; return json({ error: failure.status ? failure.message : "帳號服務暫時無法使用" }, failure.status || 503); }
}
