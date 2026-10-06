import { env } from "cloudflare:workers";
import { HistoryPanel } from "./history-panel";
// Full document navigation resets the workspace save queue and avoids vinext Link prefetch.
/* eslint-disable @next/next/no-html-link-for-pages */
import { LedgerPanel } from "./ledger-panel";
import { pageUser } from "../account-server";
import { AdminWorkspace } from "./admin-workspace";
export const dynamic = "force-dynamic";
export default async function AdminPage() { const user = await pageUser(true); return user.authProvider === "sites" ? <main className="content"><a href="/">返回試用工作台</a><h1>帳本管理</h1><LedgerPanel sessionId={user.sessionId}/><HistoryPanel sessionId={user.sessionId} /></main> : <AdminWorkspace user={user} clientId={String(env.GOOGLE_CLIENT_ID || "")} />; }
