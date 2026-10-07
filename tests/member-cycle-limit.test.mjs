import test from 'node:test';
import assert from 'node:assert/strict';
import {enforceMemberCycleLimit} from '../lib/member-cycle-limit.mjs';
import {emptyDataset} from '../lib/auth-core.mjs';
const member={isOwner:false};
export function cycleDataset(count){const d=emptyDataset();for(let i=0;i<count;i++)for(const [j,side] of ['BUY','SELL'].entries())d.fills.push({id:`fill-${i}-${j}`,accountId:'main',symbol:'AAPL',market:'US',currency:'USD',side,quantity:1,price:100+j,fee:0,timestamp:new Date(Date.UTC(2026,0,1)+i*120000+j*60000).toISOString()});return d;}
test('500 completed cycles allowed, cycle 501 rejected, owner exempt',()=>{
 const a=cycleDataset(500),b=cycleDataset(501);assert.doesNotThrow(()=>enforceMemberCycleLimit(member,emptyDataset(),a));assert.throws(()=>enforceMemberCycleLimit(member,a,b),e=>e.status===422);assert.doesNotThrow(()=>enforceMemberCycleLimit({isOwner:true},a,b));
});
test('split fills count by flat-to-flat cycle, open positions are not completed cycles',()=>{
 const d=cycleDataset(499);d.fills.push({id:'buy-a',accountId:'main',symbol:'MSFT',market:'US',currency:'USD',side:'BUY',quantity:2,price:100,fee:0,timestamp:'2026-09-01T00:00:00Z'},{id:'sell-a',accountId:'main',symbol:'MSFT',market:'US',currency:'USD',side:'SELL',quantity:1,price:101,fee:0,timestamp:'2026-09-02T00:00:00Z'},{id:'sell-b',accountId:'main',symbol:'MSFT',market:'US',currency:'USD',side:'SELL',quantity:1,price:101,fee:0,timestamp:'2026-09-03T00:00:00Z'});assert.doesNotThrow(()=>enforceMemberCycleLimit(member,emptyDataset(),d));d.fills.push({id:'open',accountId:'main',symbol:'MSFT',market:'US',currency:'USD',side:'BUY',quantity:1,price:100,fee:0,timestamp:'2026-09-04T00:00:00Z'});assert.doesNotThrow(()=>enforceMemberCycleLimit(member,emptyDataset(),d));
});
test('legacy over-limit data remains editable/exportable and may shrink but cannot grow',()=>{
 const d=cycleDataset(502),reviewed={...d,cycleReviews:{a:{note:'Review'}}};assert.doesNotThrow(()=>enforceMemberCycleLimit(member,d,reviewed));assert.doesNotThrow(()=>enforceMemberCycleLimit(member,d,cycleDataset(501)));assert.throws(()=>enforceMemberCycleLimit(member,d,cycleDataset(503)),e=>e.status===422);
});
