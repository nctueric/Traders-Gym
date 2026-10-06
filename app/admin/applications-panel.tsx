"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
type Application = { id: string; name: string; email: string; explanation: string; status: string; revision: number; submittedAt: string; reviewNote: string; access?: string };
type History = { revision: number; action: string; explanation: string; note: string; createdAt: string };
const labels: Record<string, string> = { PENDING: '待審核', APPROVED: '已核准', REJECTED: '未通過', SUBMITTED: '提交／修改' };
export function ApplicationsPanel({ sessionId }: { sessionId: string }) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('PENDING'), [page, setPage] = useState(0), [rows, setRows] = useState<Application[]>([]), [count, setCount] = useState(0), [more, setMore] = useState(false);
  const [selected, setSelected] = useState<Application | null>(null), [history, setHistory] = useState<History[]>([]), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('');
  const inFlight = useRef(false), selection = useRef(0), detailHeading = useRef<HTMLHeadingElement>(null);
  const request = useCallback(async (suffix = '', body?: unknown, signal?: AbortSignal) => {
    const response = await fetch(`/api/admin/applications${suffix}`, { method: body ? 'POST' : 'GET', headers: { 'x-workspace-session': sessionId, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: signal || AbortSignal.timeout(20000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || '讀取失敗，請重試'); return data;
  }, [sessionId]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try { const data = await request(`?q=${encodeURIComponent(query)}&status=${filter}&page=${page}`, undefined, signal); if (!signal?.aborted) { setRows(data.applications); setCount(data.pendingCount); setMore(data.hasMore); } }
    catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '載入失敗'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [query, filter, page, request]);
  useEffect(() => { const controller = new AbortController(), timer = setTimeout(() => void load(controller.signal), 150); return () => { clearTimeout(timer); controller.abort(); }; }, [load]);
  async function open(id: string) {
    if (note && !confirm('尚有未提交的審核備註，確定切換申請？')) return;
    const seq = ++selection.current; setSelected(null); setError(''); setNote('');
    try { const data = await request(`?id=${encodeURIComponent(id)}`); if (seq === selection.current) { setSelected(data.application); setHistory(data.history); requestAnimationFrame(() => detailHeading.current?.focus()); } }
    catch (cause) { if (seq === selection.current) setError(cause instanceof Error ? cause.message : '讀取失敗'); }
  }
  async function review(decision: string) {
    if (!selected || inFlight.current) return; inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try { await request('', { id: selected.id, revision: selected.revision, decision, note }); setMessage(`${selected.name}：${labels[decision]}`); setSelected(null); setNote(''); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '審核失敗，備註已保留'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="application-management" aria-labelledby="applications-heading">
    <div className="panel-head"><h2 id="applications-heading">申請審核 <span className="application-count">{count} 筆待審</span></h2><button className="ghost" disabled={busy || loading} onClick={() => { setError(''); void load(); }}>重新整理</button></div>
    <div className="admin-toolbar"><label>搜尋申請<input type="search" value={query} placeholder="姓名或 Google 信箱" onChange={event => { setQuery(event.target.value); setPage(0); }} /></label><label>審核狀態<select value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="">全部</option>{Object.entries(labels).filter(([key]) => key !== 'SUBMITTED').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    {error && <p role="alert" className="account-alert">{error}</p>}{message && <p role="status" className="account-feedback">{message}</p>}
    <div className="application-review-layout"><div aria-busy={loading}>
      {loading ? <p role="status">正在讀取申請…</p> : !rows.length ? <p>沒有符合條件的申請。</p> : <ul className="application-list">{rows.map(row => <li key={row.id}><button className="application-list-item" aria-pressed={selected?.id === row.id} disabled={busy} onClick={() => void open(row.id)}><span className="application-list-heading"><strong>{row.name}</strong><span>{labels[row.status]}</span></span><span>{row.email}</span><span className="application-excerpt">{row.explanation}</span><small>{new Date(row.submittedAt).toLocaleString('zh-TW')}</small></button></li>)}</ul>}
      <div className="account-actions"><button className="ghost" disabled={!page || loading} onClick={() => setPage(value => value - 1)}>上一頁</button><span>第 {page + 1} 頁</span><button className="ghost" disabled={!more || loading} onClick={() => setPage(value => value + 1)}>下一頁</button></div>
    </div><div className="application-detail">
      {selected ? <><h3 tabIndex={-1} ref={detailHeading}>{selected.name} 的申請</h3><p>{selected.email} · 版本 {selected.revision}</p><p className="application-reason">{selected.explanation}</p>
        {selected.reviewNote && <p className="application-note">審核說明：{selected.reviewNote}</p>}
        {selected.status === 'PENDING' ? <form onSubmit={event => { event.preventDefault(); void review('APPROVED'); }}><label htmlFor="review-note">審核說明<span className="auth-privacy">（申請人可見；不通過時必填）</span></label><textarea id="review-note" rows={4} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} disabled={busy} /><div className="account-actions"><button className="primary" disabled={busy}>{busy ? '提交中…' : '核准申請'}</button><button className="ghost" type="button" disabled={busy || !note.trim()} onClick={() => void review('REJECTED')}>不通過</button></div></form> : <p>審核結果已保存。使用權限以「帳號管理」中的最新狀態為準。</p>}
        <details className="auth-secondary"><summary>申請與審核歷程（{history.length}）</summary><ol className="application-history">{history.map(item => <li key={item.revision}><strong>版本 {item.revision} · {labels[item.action]}</strong><small>{new Date(item.createdAt).toLocaleString('zh-TW')}</small><p>{item.explanation}</p>{item.note && <p>審核說明：{item.note}</p>}</li>)}</ol></details>
      </> : <p className="application-detail-empty">選擇一筆申請，查看完整說明並審核。</p>}
    </div></div>
  </section>;
}
