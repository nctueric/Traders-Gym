import {marketRotation} from '@/lib/rotation-market.mjs';
import {serveMarket} from '../service';
export const GET=(request:Request)=>serveMarket(request,marketRotation);
