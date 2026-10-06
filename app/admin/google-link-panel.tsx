"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { GoogleButton } from '../login/google-button';
export function GoogleLinkPanel({ sessionId, clientId, provider }: { sessionId: string; clientId: string; provider?: string }) {
  const [state, setState] = useState<{ linked: boolean; available: boolean; email: string } | null>(null), [challenge, setChallenge] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false);
  const request = useCallback(async (action: string, body?: unknown) => {
    const response = await fetch(`/api/auth/google-link${action ? `?action=${action}` : ''}`, { method: body ? 'POST' : 'GET', headers: { 'x-workspace-session': sessionId, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || '連結未完成'); return data;
  }, [sessionId]);
  useEffect(() => { let active = true; void request('').then(value => { if (active) setState(value); }).catch(cause => { if (active) setError(cause.message); }); return () => { active = false; }; }, [request]);
  const finish = useCallback(async (credential: string) => {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError('');
    try { await request('complete', { challenge, credential }); setChallenge(''); setState(await request('')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '連結未完成，請重新確認密碼'); setChallenge(''); }
    finally { inFlight.current = false; setBusy(false); }
  }, [challenge, request]);
  async function start(event: React.FormEvent) {
    event.preventDefault(); if (inFlight.current) return; inFlight.current = true; setBusy(true); setError('');
    try { const data = await request('start', { password }); setPassword(''); setChallenge(data.challenge); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '密碼確認失敗'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="application-management" aria-labelledby="google-link-heading"><h2 id="google-link-heading">Google 帳號連結</h2>
    <p>連結後，Google 與密碼登入會開啟同一份帳本。</p>{error && <p role="alert" className="account-alert">{error}</p>}
    {state?.linked ? <p role="status">已連結 Google。原有帳本與密碼備援均保留。</p> : !state ? <p>正在確認連結狀態…</p> : !state.available ? <p>尚待設定 Google Client ID。原有密碼登入仍可使用。</p> : !['password','email'].includes(provider||'') ? <p>請先使用Mail 登入，才能連結 Google。</p> : <>
      <p>請連結：<strong>{state.email}</strong></p>
      <form className="google-link-form" onSubmit={start}><label htmlFor="link-password">再次確認密碼</label><input id="link-password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /><button className="primary" disabled={busy}>{busy ? '驗證中…' : '確認密碼'}</button></form>
      {challenge && <div className="google-link-confirm"><p>請在 5 分鐘內選擇上方 Google 帳號。</p><GoogleButton clientId={clientId} nonce={challenge} onCredential={finish} /><p className="auth-privacy">若彈出視窗被封鎖，請允許此網站的彈出視窗後重試。</p></div>}
    </>}
  </section>;
}
