import { env } from 'cloudflare:workers';
import { ApplicationForm } from './application-form';
export const dynamic = 'force-dynamic';
export default function ApplyPage() { return <ApplicationForm clientId={String(env.GOOGLE_CLIENT_ID || '')} />; }
