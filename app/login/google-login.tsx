"use client";
import { useEffect, useRef, useState } from "react";
type GoogleApi = { accounts: { id: { initialize(options: Record<string, unknown>): void; renderButton(element: HTMLElement, options: Record<string, unknown>): void } } };

export function GoogleLogin({ clientId }: { clientId: string }) {
  const button = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const errors: Record<string, string> = { denied: "此帳號尚未受邀或已停用。請使用受邀的 Google 帳號重新登入。", setup: "登入尚未開放，請稍後再試。", failed: "Google 登入未完成，請重新登入。", expired: "登入已到期或帳號已變更。請重新登入以恢復你的工作。" };
    // Browser-only URL/WebView state is unavailable during server rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessage(errors[new URLSearchParams(location.search).get("error") || ""] || "");
    if (window.top !== window.self || /; wv\)|FBAN|FBAV|Line\//i.test(navigator.userAgent)) {
      setMessage("請在外部 Chrome、Safari 或 Edge 瀏覽器開啟此網址，再使用 Google 登入。"); return;
    }
    if (!clientId) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      const google = (window as Window & { google?: GoogleApi }).google;
      if (!google || !button.current) return;
      google.accounts.id.initialize({ client_id: clientId, ux_mode: "redirect", login_uri: `${location.origin}/api/auth/google`, auto_select: false });
      google.accounts.id.renderButton(button.current, { theme: "outline", size: "large", text: "signin_with", locale: "zh_TW", width: 280 });
      setReady(true);
    };
    script.onerror = () => setMessage("Google 登入元件無法載入。請檢查網路連線後重新整理。");
    document.head.appendChild(script);
    return () => { script.onload = null; script.remove(); };
  }, [clientId]);
  return <main className="auth-page"><section className="auth-panel" aria-labelledby="login-heading">
    <div className="brand"><span>TR</span><strong>交易復盤顧問</strong></div>
    <h1 id="login-heading">登入你的交易帳本</h1>
    <p>使用受邀的 Google 帳號，接續你的交易紀錄與復盤。</p>
    {message && <p className="account-alert" role="alert">{message}</p>}
    {clientId ? <><div ref={button} className="google-button" />{!ready && !message && <p role="status">正在準備 Google 登入…</p>}</> : <p className="account-alert" role="status">Google 登入尚未開放。設定完成後即可使用受邀帳號登入。</p>}
    <p className="auth-privacy">我們使用 Google 的姓名、email 與帳號識別資料來驗證身分，不存取 Gmail 或 Google Drive。交易資料保存在你的獨立帳本。</p>
    <a href="/privacy">隱私與資料使用</a>
  </section></main>;
}
