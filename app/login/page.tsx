import { env } from "cloudflare:workers";
import { GoogleLogin } from "./google-login";
export const dynamic = "force-dynamic";
export default function LoginPage() { return <GoogleLogin clientId={String(env.GOOGLE_CLIENT_ID || "")} />; }
