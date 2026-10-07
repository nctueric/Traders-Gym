import TradeWorkspace from "./trade-workspace";
import { pageUser } from "./account-server";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: {searchParams:Promise<{accountId?:string}>}) { const user = await pageUser(); const params=await searchParams; const accountId=typeof params.accountId==='string'?params.accountId:undefined; return <TradeWorkspace key={`${user.sessionId}:${accountId || ''}`} user={user} requestedAccountId={accountId}  />; }
