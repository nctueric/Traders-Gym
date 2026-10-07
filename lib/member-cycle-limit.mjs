import {buildCycles} from './trade-engine.mjs';
import {authError} from './auth-core.mjs';
export const MEMBER_CYCLE_LIMIT=500;
export function enforceMemberCycleLimit(user,current,next) {
 if(user.isOwner)return;
 const after=buildCycles({fills:next.fills||[],marketBars:[]}).cycles.length;
 if(after<=MEMBER_CYCLE_LIMIT)return;
 const before=buildCycles({fills:current.fills||[],marketBars:[]}).cycles.length;
 if(before>MEMBER_CYCLE_LIMIT&&after<=before)return;
 throw authError('一般會員每份帳本最多 500 組已完成交易閉環；請調整成交資料或匯入內容後重試',422);
}
