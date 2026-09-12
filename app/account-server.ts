import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authError, json, requireSession } from "@/lib/auth-core.mjs";
import { createAccountApi } from "@/lib/account-api.mjs";

export type AccountUser = { id: string; email: string; name: string; picture: string; isOwner: boolean; sessionId: string; expiresAt: string };
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
  return requireSession(env.DB, request, { owner });
}
export async function pageUser(owner = false) {
  const incoming = await headers();
  const request = new Request(`https://${incoming.get("host") || "localhost"}/`, { headers: incoming });
  try { return await apiUser(request, owner); }
  catch (error) {
    if ((error as { status?: number }).status === 403 && owner) redirect("/forbidden");
    redirect("/login");
  }
}
export async function accountHandler(request: Request) {
  if (!env.DB) return json({ error: "帳號服務尚未設定" }, 503);
  return createAccountApi({ db: env.DB, objects: env.SNAPSHOTS, clientId: String(env.GOOGLE_CLIENT_ID || "") }).handle(request);
}
export async function rejectAnonymous(request: Request) {
  try { await apiUser(request); return null; }
  catch (error) { const failure = error as { status?: number; message?: string }; return json({ error: failure.status ? failure.message : "帳號服務暫時無法使用" }, failure.status || 503); }
}
