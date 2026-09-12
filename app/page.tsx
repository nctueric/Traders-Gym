import { env } from "cloudflare:workers";
import TradeWorkspace from "./trade-workspace";
import { pageUser } from "./account-server";
export const dynamic = "force-dynamic";
export default async function Page() { const user = await pageUser(); return <TradeWorkspace key={user.sessionId} user={user} storageTarget={env.LOCAL_ACCOUNT_SERVICE === "true" ? "本機檔案" : "雲端"} />; }
