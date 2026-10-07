import {env} from 'cloudflare:workers';
import {publicMarket} from '@/lib/market-data.mjs';
type Limiter={limit:(options:{key:string})=>Promise<{success:boolean}>};
export function serveMarket(request:Request,handler:Parameters<typeof publicMarket>[1]) {
 const bindings=env as unknown as {MARKET_RATE_LIMITER?:Limiter};
 const cache=(caches as unknown as {default?:Cache}).default;
 return publicMarket(request,handler,{limiter:bindings.MARKET_RATE_LIMITER,cache});
}
