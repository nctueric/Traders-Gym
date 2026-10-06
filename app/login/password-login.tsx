"use client";
import { useState } from "react";

export function PasswordLogin({ embedded = false }: { embedded?: boolean }) {
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
  const form = <>
    <form className="password-login-form" onSubmit={submit}>
      <label htmlFor="login-email">帳號 Email</label>
      <input id="login-email" name="email" type="email" autoComplete="username" required maxLength={254} disabled={busy} />
      <label htmlFor="login-password">密碼</label>
      <input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={256} disabled={busy} />
      {error && <p role="alert" className="account-alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? "登入中…" : "登入"}</button>
    </form>
  </>;
  return embedded ? form : <main className="auth-page"><section className="auth-panel"><h1>擁有者密碼登入</h1>{form}</section></main>;
}
