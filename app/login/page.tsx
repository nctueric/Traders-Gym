import { env } from "cloudflare:workers";
import { GoogleLogin } from "./google-login";
export const dynamic = "force-dynamic";
export default function LoginPage() { if (env.SITES_TRIAL_AUTH === "true") return <main className="auth-page"><section className="auth-panel"><h1>私人 Sites 試用</h1><p>使用 ChatGPT 登入，進入獨立試用帳本。Google 登入驗收暫停。</p><a href="/signin-with-chatgpt?return_to=%2F" target="_top">使用 ChatGPT 繼續</a></section></main>; return <GoogleLogin clientId={String(env.GOOGLE_CLIENT_ID || "")} />; }
