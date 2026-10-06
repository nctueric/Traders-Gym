import Link from "next/link";
import {env} from 'cloudflare:workers';
import {pageUser} from '../account-server';
import {Brand} from '../brand';
import {MailSettings} from './mail-settings';
import {GoogleLinkPanel} from '../admin/google-link-panel';
export const dynamic='force-dynamic';
export default async function SettingsPage(){const user=await pageUser();return <main className="auth-page"><section className="auth-panel settings-panel"><Brand/><h1>帳號設定</h1><p>{user.email}</p><MailSettings email={user.email} sessionId={user.sessionId}/>{user.authProvider!=='google'&&<GoogleLinkPanel sessionId={user.sessionId} clientId={String(env.GOOGLE_CLIENT_ID||'')} provider={user.authProvider}/>}<Link href="/">返回持倉</Link></section></main>;}
