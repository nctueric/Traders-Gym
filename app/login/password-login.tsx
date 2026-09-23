"use client";
import { useState } from "react";

export function PasswordLogin() {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "登入失敗，請再試一次");
      window.location.replace("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "登入服務暫時無法使用"); setBusy(false); }
  }
  return <main className="auth-page"><section className="auth-panel" aria-labelledby="password-login-heading">
    <div className="brand"><span>TR</span><strong>交易復盤顧問</strong></div>
    <h1 id="password-login-heading">登入個人測試帳本</h1>
    <p>使用你的測試帳號與密碼。Google 登入尚未啟用。</p>
    <form className="password-login-form" onSubmit={submit}>
      <label htmlFor="login-email">帳號 Email</label>
      <input id="login-email" name="email" type="email" autoComplete="username" required maxLength={254} disabled={busy} />
      <label htmlFor="login-password">測試密碼</label>
      <input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={256} disabled={busy} />
      {error && <p role="alert" className="account-alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? "登入中…" : "登入"}</button>
    </form>
    <p className="auth-privacy">資料會保存在你的私人雲端帳本，並可下載 JSON 備份。</p>
    <a href="/privacy">隱私與資料使用</a>
  </section></main>;
}
