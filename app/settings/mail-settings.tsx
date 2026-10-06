"use client";
import { useEffect, useState } from 'react';
import { EmailRequest } from '../login/email-request';

export function MailSettings({ email, sessionId }: { email: string; sessionId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/auth/email', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '無法讀取 Mail 登入狀態');
        if (!controller.signal.aborted) { setEnabled(data.enabled === true); setError(''); }
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '讀取失敗'); });
    return () => controller.abort();
  }, [attempt]);
  return <section aria-labelledby="mail-settings-title">
    <h2 id="mail-settings-title">Mail 備用登入</h2>
    <p>Google 登入後，可選擇為同一帳號設定備用密碼。Mail 帳號使用目前信箱，兩種登入方式共用原有帳本。</p>
    {error ? <><p className="account-alert" role="alert">{error}</p><button className="ghost" onClick={() => setAttempt(value => value + 1)}>重試</button></> : enabled === null ? <p role="status">正在讀取登入設定…</p> : <>
      <p role="status">{enabled ? '已啟用 Mail 備用登入' : '尚未設定；可繼續使用 Google 登入。'}</p>
      <button className="ghost" aria-expanded={expanded} aria-controls="mail-settings-form" onClick={() => setExpanded(value => !value)}>{expanded ? '收起設定' : enabled ? '更新 Mail 密碼' : '設定 Mail 備用登入'}</button>
      {expanded && <div id="mail-settings-form"><p>驗證信箱後設定至少 12 字元的密碼。完成後需重新登入；帳本不會變更。</p><EmailRequest purpose="setup" email={email} sessionId={sessionId}/></div>}
    </>}
  </section>;
}
