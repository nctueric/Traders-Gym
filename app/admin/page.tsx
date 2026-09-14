import Link from "next/link";
import { HistoryPanel } from "./history-panel";
import { pageUser } from "../account-server";
import { AdminWorkspace } from "./admin-workspace";
export const dynamic = "force-dynamic";
export default async function AdminPage() { const user = await pageUser(true); return user.authProvider === "sites" ? <main className="content"><Link href="/">返回試用工作台</Link><h1>試用帳本歷史版本</h1><p>僅管理獨立試用帳本。Google 帳號管理驗收暫停。</p><HistoryPanel sessionId={user.sessionId} /></main> : <AdminWorkspace user={user} />; }
