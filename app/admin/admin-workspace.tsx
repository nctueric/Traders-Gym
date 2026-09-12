"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Full navigation discards account state. */
import { useCallback, useEffect, useState } from "react";
import type { AccountUser } from "../account-server";
import { HistoryPanel } from "./history-panel";
import { DialogFrame } from "../workspace-ui";
type Account = { id?: string; email: string; name?: string; status: string; isOwner?: number; lastLoginAt?: string; version?: number; updatedAt?: string; saveMode?: string; sizeBytes?: number };
type Event = { action: string; email: string; result: string; createdAt: string };
const statusLabels: Record<string, string> = { ACTIVE: "已啟用", DISABLED: "已停用", PENDING: "等待登入", REVOKED: "邀請已撤銷" };
const actionLabels: Record<string, string> = { invite: "新增邀請", revoke_invite: "撤銷邀請", disable: "停用帳號", enable: "恢復帳號", revoke_sessions: "登出所有裝置" };
const date = (value?: string) => value ? new Date(value).toLocaleString("zh-TW", { hour12: false }) : "尚無紀錄";

export function AdminWorkspace({ user }: { user: AccountUser }) {
  const [tab, setTab] = useState("accounts"), [query, setQuery] = useState(""), [status, setStatus] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]), [events, setEvents] = useState<Event[]>([]);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false), [email, setEmail] = useState("");
  const [confirmation, setConfirmation] = useState<{ action: string; email: string } | null>(null);
  const [eventAction, setEventAction] = useState(""), [page, setPage] = useState(0), [hasMore, setHasMore] = useState(false);
  const request = useCallback(async (url: string, body?: unknown, signal?: AbortSignal) => {
    const response = await fetch(url, { method: body ? "POST" : "GET", headers: { "x-workspace-session": user.sessionId, ...(body ? { "Content-Type": "application/json" } : {}) }, cache: "no-store", signal, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 401 || response.status === 403) { location.replace("/login?error=expired"); throw new Error("登入權限已變更"); }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "操作未完成，請重試");
    return result;
  }, [user.sessionId]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      if (tab === "events") {
        const result = await request(`/api/admin/events?q=${encodeURIComponent(query)}&action=${eventAction}&page=${page}`, undefined, signal);
        if (!signal?.aborted) { setEvents(result.events); setHasMore(result.hasMore); }
      } else {
        const result = await request("/api/admin/accounts", undefined, signal);
        if (!signal?.aborted) setAccounts([...result.accounts, ...result.invites]);
      }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "載入失敗"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [request, tab, query, eventAction, page]);
  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => void load(controller.signal), 150); return () => { clearTimeout(timer); controller.abort(); }; }, [load]);
  async function mutate(action: string, target: string) {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    try { await request("/api/admin/accounts", { action, email: target }); setMessage(`${target}：${actionLabels[action]}完成`); setInviteOpen(false); setConfirmation(null); setEmail(""); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作未完成"); }
    finally { setBusy(false); }
  }
  const rows = accounts.filter(a => `${a.email} ${a.name || ""}`.toLowerCase().includes(query.toLowerCase()) && (!status || a.status === status));
  const actions = (account: Account) => account.isOwner ? <span className="account-owner">系統擁有者</span> : <div className="account-actions">{(account.status === "PENDING" ? ["revoke_invite"] : account.status === "REVOKED" ? ["invite"] : account.status === "DISABLED" ? ["enable"] : ["disable", "revoke_sessions"]).map(action => <button className="ghost" key={action} type="button" disabled={busy} onClick={() => setConfirmation({ action, email: account.email })}>{actionLabels[action]}</button>)}</div>;
  return <div className="shell admin-shell"><aside className="sidebar"><div className="brand"><span>TR</span><strong>交易復盤顧問</strong></div><a className="admin-back" href="/">返回交易工作區</a><div className="admin-owner"><strong>{user.name}</strong><span>{user.email}</span><small>系統擁有者</small></div></aside>
    <main className="content admin-content"><header className="topbar"><h1>系統管理</h1>{tab === "accounts" && <button className="primary" type="button" onClick={() => { setError(""); setInviteOpen(true); }}>新增邀請</button>}</header>
      <nav className="admin-tabs" aria-label="後台管理分頁">{[["accounts", "帳號管理"], ["storage", "儲存狀態"], ["events", "操作紀錄"]].map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => { setTab(id); setQuery(""); setStatus(""); setPage(0); }}>{label}</button>)}</nav>
      {error && <p className="account-alert" role="alert">{error}</p>}{message && <p className="account-feedback" role="status">{message}</p>}
      <section className="admin-toolbar" aria-label="搜尋與篩選"><label>搜尋帳號<input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="姓名或 email" /></label>{tab === "events" ? <label>操作<select value={eventAction} onChange={e => { setEventAction(e.target.value); setPage(0); }}><option value="">全部操作</option>{Object.entries(actionLabels).map(([key, value]) => <option value={key} key={key}>{value}</option>)}</select></label> : <label>帳號狀態<select value={status} onChange={e => setStatus(e.target.value)}><option value="">全部狀態</option>{Object.entries(statusLabels).map(([key, value]) => <option value={key} key={key}>{value}</option>)}</select></label>}<button className="ghost" type="button" disabled={loading} onClick={() => void load()}>重新整理</button></section>
      <section className="admin-results" aria-busy={loading} aria-label={tab === "events" ? "操作紀錄" : "帳號列表"}>
        {loading ? <p role="status" className="account-empty">正在載入…</p> : tab === "events" ? <>{!events.length ? <p className="account-empty">沒有符合條件的操作紀錄。</p> : <div className="admin-table-wrap"><table><thead><tr><th>時間</th><th>操作</th><th>目標帳號</th><th>結果</th></tr></thead><tbody>{events.map((event, i) => <tr key={`${event.createdAt}-${i}`}><td data-label="時間">{date(event.createdAt)}</td><td data-label="操作">{actionLabels[event.action] || event.action}</td><td data-label="帳號">{event.email}</td><td data-label="結果">{event.result === "SUCCESS" ? "完成" : "已拒絕"}</td></tr>)}</tbody></table></div>}<div className="account-actions"><button className="ghost" disabled={!page} onClick={() => setPage(p => p - 1)}>上一頁</button><span>第 {page + 1} 頁</span><button className="ghost" disabled={!hasMore} onClick={() => setPage(p => p + 1)}>下一頁</button></div></> : !rows.length ? <p className="account-empty">沒有符合條件的帳號。{tab === "accounts" && "你可以新增邀請，讓團隊成員建立自己的交易帳本。"}</p> : <div className="admin-table-wrap"><table><thead><tr><th>帳號</th><th>狀態</th>{tab === "accounts" ? <><th>最近登入</th><th>操作</th></> : <><th>資料大小／版本</th><th>最近成功儲存</th><th>來源</th></>}</tr></thead><tbody>{rows.map(account => <tr key={account.email}><td data-label="帳號"><strong>{account.name || account.email}</strong>{account.name && <small>{account.email}</small>}</td><td data-label="狀態"><span className={`account-status status-${account.status.toLowerCase()}`}>{statusLabels[account.status]}</span></td>{tab === "accounts" ? <><td data-label="最近登入">{date(account.lastLoginAt)}</td><td data-label="操作">{actions(account)}</td></> : <><td data-label="資料">{account.version ? `${((account.sizeBytes || 0) / 1024).toFixed(1)} KB · v${account.version}` : "尚未建立"}</td><td data-label="最近儲存">{date(account.updatedAt)}</td><td data-label="來源">{{ auto: "自動儲存", manual: "手動儲存", initial: "首次建立", legacy: "原有資料" }[account.saveMode || ""] || "—"}</td></>}</tr>)}</tbody></table></div>}
      </section>
      {tab === "storage" && <HistoryPanel sessionId={user.sessionId} />}
      {tab === "accounts" && <div className="admin-login-link"><span>受邀者登入網址</span><button className="ghost" type="button" onClick={() => navigator.clipboard.writeText(`${location.origin}/login`).then(() => setMessage("登入網址已複製"), () => setError("無法複製，請從瀏覽器網址列複製網站網址並加上 /login"))}>複製登入網址</button></div>}
    </main>
    {inviteOpen && <DialogFrame label="新增邀請" onClose={() => !busy && setInviteOpen(false)}><form className="modal account-dialog" onSubmit={e => { e.preventDefault(); void mutate("invite", email); }}><h2>新增邀請</h2><p>輸入對方的 Gmail 或 Google Workspace email。對方登入後會建立獨立交易帳本。</p><label>Google email<input type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" /></label>{error && <p role="alert" className="account-alert">{error}</p>}<div className="account-actions"><button className="ghost" type="button" disabled={busy} onClick={() => setInviteOpen(false)}>取消</button><button className="primary" disabled={busy}>{busy ? "建立中…" : "建立邀請"}</button></div></form></DialogFrame>}
    {confirmation && <DialogFrame label={actionLabels[confirmation.action]} onClose={() => !busy && setConfirmation(null)}><section className="modal account-dialog"><h2>{actionLabels[confirmation.action]}</h2><p className="account-target">{confirmation.email}</p><p>{confirmation.action === "disable" ? "此帳號將立即失去存取權限，所有裝置會登出。交易資料會保留。" : confirmation.action === "revoke_sessions" ? "此帳號所有裝置都需要重新登入，交易資料會保留。" : "確認後將更新這個帳號的存取狀態。"}</p>{error && <p role="alert" className="account-alert">{error}</p>}<div className="account-actions"><button className="ghost" type="button" disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button className="primary" type="button" disabled={busy} onClick={() => void mutate(confirmation.action, confirmation.email)}>{busy ? "處理中…" : "確認"}</button></div></section></DialogFrame>}
  </div>;
}
