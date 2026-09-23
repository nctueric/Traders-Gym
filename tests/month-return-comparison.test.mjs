import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkMonthReturn} from '../lib/month-return-comparison.mjs';
test('QQQ monthly return uses prior close and excludes future prices',()=>{
 const bars=[{date:'2026-09-24',close:200},{date:'2026-08-31',close:100},{date:'2026-09-22',close:110}];
 assert.ok(Math.abs(benchmarkMonthReturn(bars,'2026-09-01','2026-09-23').rate-.1)<1e-10);
 assert.equal(benchmarkMonthReturn(bars,'2026-09-01','2026-09-23').date,'2026-09-22');
});
test('missing, invalid and stale prices are not zero returns',()=>{
 for(const bars of [[],[{date:'2026-08-31',close:null},{date:'2026-09-22',close:110}],[{date:'2026-08-01',close:100},{date:'2026-09-22',close:110}]]) assert.equal(benchmarkMonthReturn(bars,'2026-09-01','2026-09-23').rate,null);
});
