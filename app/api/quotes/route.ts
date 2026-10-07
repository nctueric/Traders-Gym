import { marketQuotes } from '@/lib/market-data.mjs';
import { rejectAnonymous } from '@/app/account-server';
export async function GET(request: Request) {
 const denied=await rejectAnonymous(request);if(denied)return denied;
 return marketQuotes(request);
}
