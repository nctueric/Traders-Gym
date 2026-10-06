"use client";
import { useEffect, useRef, useState } from 'react';
type GoogleApi = { accounts: { id: { initialize(options: Record<string, unknown>): void; renderButton(element: HTMLElement, options: Record<string, unknown>): void } } };
let loader: Promise<GoogleApi> | undefined;
function loadGoogle() {
  if (loader) return loader;
  loader = new Promise<GoogleApi>((resolve, reject) => {
    const available = (window as Window & { google?: GoogleApi }).google;
    if (available) { resolve(available); return; }
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = () => { const google = (window as Window & { google?: GoogleApi }).google; if (google) resolve(google); else reject(new Error('Google 登入元件無法載入')); };
    script.onerror = () => { script.remove(); loader = undefined; reject(new Error('Google 登入元件無法載入，請檢查網路後重新整理')); };
    document.head.appendChild(script);
  });
  return loader;
}
export function GoogleButton({ clientId, nonce, onCredential }: { clientId: string; nonce?: string; onCredential?: (value: string) => void }) {
  const target = useRef<HTMLDivElement>(null), [error, setError] = useState(''), [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    if (!clientId) return;
    Promise.resolve().then(async () => {
      if (window.top !== window.self || /; wv\)|FBAN|FBAV|Line\//i.test(navigator.userAgent)) throw new Error('請使用外部 Chrome、Safari 或 Edge 瀏覽器開啟網站，再以 Google 驗證');
      const google = await loadGoogle(); if (!active || !target.current) return;
      google.accounts.id.initialize({ client_id: clientId, auto_select: false, ...(onCredential ? { ux_mode: 'popup', nonce, callback: (response: { credential: string }) => { if (active) onCredential(response.credential); } } : { ux_mode: 'redirect', login_uri: `${location.origin}/api/auth/google` }) });
      google.accounts.id.renderButton(target.current, { theme: 'outline', size: 'large', locale: 'zh_TW', width: Math.max(200, Math.min(400,target.current.parentElement?.clientWidth||280)) }); setReady(true);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Google 登入元件無法載入'); });
    return () => { active = false; };
  }, [clientId, nonce, onCredential]);
  if (!clientId) return <p role="status">Google 登入尚未設定，申請暫未開放。</p>;
  return <div className="google-button"><div ref={target} />{error ? <p role="alert" className="account-alert">{error}</p> : !ready ? <p role="status">正在準備 Google 驗證…</p> : null}</div>;
}
