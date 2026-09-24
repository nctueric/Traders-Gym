import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeSnapshotRequest,decodeSnapshotRequest} from '../lib/snapshot-transport.mjs';
test('large snapshot gzip preserves every field with substantial size reduction',async()=>{
 const original={fills:[{id:'real',price:29.6}],marketBars:Array.from({length:10000},(_,i)=>({symbol:'AAA',date:String(i),open:30,high:32,low:29,close:31,volume:20000}))};
 const json=JSON.stringify(original), encoded=await encodeSnapshotRequest(json);
 assert.equal(encoded.headers['Content-Encoding'],'gzip');
 assert.ok(encoded.body.byteLength<Buffer.byteLength(json)*0.25);
 const decoded=await decodeSnapshotRequest(new Request('https://example.test',{method:'PUT',...encoded}));
 assert.deepEqual(decoded,original);
});
test('small and legacy JSON remain compatible, corrupt gzip fails before writing',async()=>{
 const body=JSON.stringify({a:1}),encoded=await encodeSnapshotRequest(body);
 assert.equal(encoded.body,body);
 assert.deepEqual(await decodeSnapshotRequest(new Request('https://example.test',{method:'PUT',...encoded})),{a:1});
 await assert.rejects(decodeSnapshotRequest(new Request('https://example.test',{method:'PUT',headers:{'Content-Encoding':'gzip'},body:'broken'})),e=>e.status===400);
});
