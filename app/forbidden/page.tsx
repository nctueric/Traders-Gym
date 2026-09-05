/* eslint-disable @next/next/no-html-link-for-pages -- Full navigation rechecks the session. */
export default function ForbiddenPage() { return <main className="auth-page"><section className="auth-panel"><h1>無法存取管理後台</h1><p>這個頁面只供系統擁有者使用。</p><a className="primary account-link" href="/">返回交易工作區</a></section></main>; }
