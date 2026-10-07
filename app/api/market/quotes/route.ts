import {marketQuotes} from '@/lib/market-data.mjs';
import {serveMarket} from '../service';
export const GET=(request:Request)=>serveMarket(request,marketQuotes);
