import test from 'node:test';
import assert from 'node:assert/strict';
import {sortCycleRows} from '../lib/cycle-table-sort.mjs';
test('sort dates, numeric loss/zero/profit and missing data without mutating input',()=>{
 const rows=[{id:'old',closeAt:'2024-01-01',pnl:100,maePct:null},{id:'new',closeAt:'2026-09-24',pnl:-20,maePct:-.1},{id:'middle',closeAt:'2025-09-24',pnl:0,maePct:-.2}];
 const original=structuredClone(rows);
 assert.deepEqual(sortCycleRows(rows).map(r=>r.id),['new','middle','old']);
 assert.deepEqual(sortCycleRows(rows,'pnl','asc').map(r=>r.pnl),[-20,0,100]);
 assert.deepEqual(sortCycleRows(rows,'maePct','asc').map(r=>r.maePct),[-.2,-.1,null]);
 assert.deepEqual(sortCycleRows(rows,'maePct','desc').map(r=>r.maePct),[-.1,-.2,null]);
 assert.deepEqual(rows,original);
});
