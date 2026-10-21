import test from 'node:test';
import assert from 'node:assert/strict';
import {d1LimitError,storageRetryDelay,BACKGROUND_SAVE_MS} from '../lib/storage-retry.mjs';
test('D1 quota is distinguished from ordinary errors and pauses to UTC midnight',()=>{
 const now=Date.parse('2026-10-12T07:00:00Z'),limit=d1LimitError(Error('D1_ERROR: exceeded daily write limit'),now);
 assert.equal(limit.code,'D1_DAILY_LIMIT');assert.equal(limit.retryAt,'2026-10-13T00:00:00.000Z');
 assert.equal(storageRetryDelay(limit,9,now),17*3600_000);
 for(const text of ['database busy','D1_ERROR: too many SQL variables','HTTP 500','daily limit exceeded'])assert.equal(d1LimitError(Error(text),now),null);
 assert.equal(BACKGROUND_SAVE_MS,600_000);assert.equal(storageRetryDelay({},0,now,1),30_000);assert.equal(storageRetryDelay({},99,now,1),600_000);
});
