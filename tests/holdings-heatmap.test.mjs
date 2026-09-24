import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutHoldings,heatmapItems,heatmapColor} from '../lib/holdings-heatmap.mjs';
test('treemap conserves exact areas without overlap at desktop and mobile sizes',()=>{
 const items=[100,50,30,10,1,.001].map((value,id)=>({id,value}));const before=JSON.stringify(items);
 for(const [w,h] of [[800,240],[350,240]]){const tiles=layoutHoldings(items,w,h),total=items.reduce((s,i)=>s+i.value,0);assert.equal(tiles.length,items.length);
 for(const a of tiles){assert.ok(Math.abs(a.width*a.height/(w*h)-a.value/total)<1e-10);assert.ok(a.x>=0&&a.y>=0&&a.x+a.width<=w+1e-8&&a.y+a.height<=h+1e-8);
 for(const b of tiles.filter(t=>t.id!==a.id)){const overlapX=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);const overlapY=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);assert.ok(overlapX<1e-8||overlapY<1e-8);}}
 }assert.equal(JSON.stringify(items),before);
});
test('missing valuation is excluded, missing daily change remains gray; short gains reverse',()=>{
 const rows=[{position:{id:'a',symbol:'A',quantity:10,direction:'LONG'},metrics:{marketValueUsd:100},quote:{price:10,previousClose:null}},{position:{id:'b',symbol:'A',quantity:10,direction:'SHORT',fills:[{side:'SELL',quantity:10,price:15,timestamp:'2026-09-22T14:00:00Z'}]},metrics:{marketValueUsd:200},quote:{price:10,previousClose:20,updatedAt:"2026-09-23T15:00:00Z"}},{position:{id:'c'},metrics:{marketValueUsd:null}}];
 const items=heatmapItems(rows);assert.equal(items[0].rate,null);assert.equal(items[1].rate,.5);assert.equal(layoutHoldings(items,400,240).length,2);assert.equal(heatmapColor(null),'#65716c');assert.notEqual(heatmapColor(-.05),heatmapColor(.05));assert.deepEqual(layoutHoldings([],100,100),[]);
});
test('color convention swaps palettes but preserves intensity and neutral values',()=>{
 for(const rate of [.005,.01,.03,.15]){
  assert.equal(heatmapColor(rate,'red-up'),heatmapColor(-rate,'green-up'));
  assert.equal(heatmapColor(-rate,'red-up'),heatmapColor(rate,'green-up'));
 }
 for(const rate of [null,NaN,0]){
  assert.equal(heatmapColor(rate,'red-up'),heatmapColor(rate,'green-up'));
 }
 assert.equal(heatmapColor(.03,'unknown'),heatmapColor(.03));
});
