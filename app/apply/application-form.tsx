"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Brand } from '../brand';
import { EmailRequest } from '../login/email-request';
import { GoogleButton } from '../login/google-button';
type Application = { explanation: string; status: string; revision: number; reviewNote: string; submittedAt: string };
type Result = { identity: { name: string; email: string; provider?: string }; sessionId: string; application: Application | null; access: string; applicationsOpen: boolean };
const labels: Record<string, string> = { PENDING: '待審核', APPROVED: '已核准', REJECTED: '未通過', ACTIVE: '已開放使用', DISABLED: '帳號已停用', REVOKED: '使用權限已撤銷', CONFLICT: '帳號需要確認', NONE: '尚未申請' };
export function ApplicationForm({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Result | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [explanation, setExplanation] = useState('');
  const loadedRevision = useRef(0), dirty = useRef(false), mutation = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/auth/application', { cache: 'no-store', signal }), payload = await response.json();
      if (response.status === 401) { setData(null); return; }
      if (!response.ok) throw new Error(payload.error || '申請讀取失敗');
      if (dirty.current && loadedRevision.current !== (payload.application?.revision || 0)) { setError('申請已在另一個頁面更新。請先複製本頁未提交內容，再重新整理並查看最新版本。'); return; }
      loadedRevision.current = payload.application?.revision || 0; setData(payload); if (!dirty.current) setExplanation(payload.application?.explanation || '');
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '讀取失敗'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(), timer = setTimeout(() => void load(controller.signal), 0); return () => { clearTimeout(timer); controller.abort(); }; }, [load]);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirty.current) event.preventDefault(); }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, []);
  async function submit(action: string) {
    if (!data || mutation.current) return; mutation.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/auth/application', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-application-session': data.sessionId }, body: JSON.stringify({ action, explanation, revision: data.application?.revision || 0 }), signal: AbortSignal.timeout(20000) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '操作失敗，輸入內容已保留');
      dirty.current = false;
      if (action === 'enter') { if(payload.redirect){location.assign(payload.redirect);return;} if(payload.message){setMessage(payload.message);return;} location.assign('/'); return; }
      if (action === 'logout') { setExplanation(''); location.assign('/apply'); return; }
      setMessage('申請已保存。管理者審核後，可回到此頁查看結果。'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失敗，請重試'); }
    finally { mutation.current = false; setBusy(false); }
  }
  const access = data?.access || 'NONE', state = access !== 'NONE' ? access : data?.application?.status || 'NONE';
  const editable = data && access === 'NONE' && data.application?.status !== 'APPROVED' && data.applicationsOpen;
  return <main className="auth-page"><section className="auth-panel application-panel" aria-labelledby="apply-title">
    <Brand/><h1 id="apply-title">申請使用</h1><p>告訴我們你希望如何記錄交易、回顧決策。核准後即可建立自己的帳本。</p>
    {error && <p role="alert" className="account-alert">{error}</p>}{message && <p role="status" className="account-feedback">{message}</p>}
    {loading ? <p role="status">正在讀取申請…</p> : !data ? <><h2>先確認身分</h2><p>先使用 Google 帳戶驗證並申請；核准登入後，可在帳號設定加上 Mail 備用密碼。既有申請仍可用原方式查詢。</p><GoogleButton clientId={clientId} /><details className="auth-secondary"><summary>使用 Email 申請／查詢</summary><EmailRequest/></details>{explanation && <div className="application-copy"><p>尚未提交的內容仍保留在本頁；重新驗證前可先複製。</p><textarea aria-label="尚未提交的申請說明" value={explanation} readOnly /></div>}</> : <>
      <div className="application-identity"><div><strong>{data.identity.name}</strong><span>{data.identity.email}</span></div><button className="ghost" disabled={busy} onClick={() => { if (!dirty.current || confirm('尚有未提交內容，確定切換帳號？')) void submit('logout'); }}>切換帳號</button></div>
      <div className="application-state" role="status"><strong>{labels[state] || state}</strong><button className="ghost" disabled={busy} onClick={() => { setError(''); void load(); }}>更新狀態</button></div>
      {['ACTIVE', 'APPROVED'].includes(access) ? <button className="primary" disabled={busy} onClick={() => void submit('enter')}>{busy ? '驗證權限中…' : data.identity.provider==='email'&&access==='APPROVED'?'寄送密碼設定信':'進入 TraderGym'}</button> : ['DISABLED', 'REVOKED', 'CONFLICT'].includes(access) ? <p>請聯絡管理者確認使用權限。重新申請不會解除這項限制。</p> : <>
        {data.application?.reviewNote && <div className="application-note"><h2>審核說明</h2><p>{data.application.reviewNote}</p></div>}
        {!data.applicationsOpen && <p>申請尚未開放，已提交的申請仍會保留。</p>}
        {editable ? <form onSubmit={event => { event.preventDefault(); void submit('submit'); }}><label htmlFor="application-reason">申請說明</label><p id="application-hint" className="auth-privacy">請說明預計如何使用 TraderGym，以及希望改善的交易紀錄或複盤流程。無需提供持倉或資產金額。</p>
          <textarea id="application-reason" value={explanation} onChange={event => { dirty.current = true; setExplanation(event.target.value); }} required maxLength={4000} rows={7} disabled={busy} aria-describedby="application-hint application-count" />
          <div className="application-submit"><span id="application-count">{[...explanation.trim()].length.toLocaleString()} / 2,000 字 · 至少 20 字</span><button className="primary" disabled={busy || [...explanation.trim()].length < 20 || [...explanation.trim()].length > 2000}>{busy ? '儲存中…' : state === 'PENDING' ? '儲存修改' : state === 'REJECTED' ? '重新申請' : '提交申請'}</button></div></form> : data.application && <p className="application-note">{data.application.explanation}</p>}
        <p className="auth-privacy">不另寄 Email；請回到此頁查詢結果。</p>
      </>}
    </>}
    <footer className="application-footer"><a href="/login">返回登入</a><a href="/privacy">隱私與資料使用</a></footer>
  </section></main>;
}
