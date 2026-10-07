import FastWorkspace from "./fast-workspace";
import { pageBootstrap, pageUser } from "./account-server";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: {searchParams:Promise<{accountId?:string}>}) { const params=await searchParams; const accountId=typeof params.accountId==='string'?params.accountId:undefined; const bootstrap=await pageBootstrap(accountId); if(bootstrap?.home)return <FastWorkspace bootstrap={bootstrap} requestedAccountId={accountId}/>; const user=bootstrap?.user||await pageUser(); const {default:TradeWorkspace}=await import("./trade-workspace"); return <TradeWorkspace initialPreferences={bootstrap} key={`${user.sessionId}:${accountId || ''}`} user={user} requestedAccountId={accountId}  />; }
