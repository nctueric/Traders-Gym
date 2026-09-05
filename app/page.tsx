import TradeWorkspace from "./trade-workspace";
import { pageUser } from "./account-server";
export const dynamic = "force-dynamic";
export default async function Page() { const user = await pageUser(); return <TradeWorkspace key={user.sessionId} user={user} />; }
