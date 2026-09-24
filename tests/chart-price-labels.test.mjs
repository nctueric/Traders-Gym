import test from 'node:test';
import assert from 'node:assert/strict';
import {chartPlanDate,chartPriceLines,chartPriceRange,layoutPriceLabels} from '../lib/chart-price-labels.mjs';
test('candles retain readable scale, low-priced shares avoid dollar minimum, all prices opt in',()=>{const candles=[{low:.09,high:.11,ema:{10:.1}}],lines=[{price:100}];const normal=chartPriceRange(candles,[10],lines);assert.ok(normal.high<.2);assert.ok(chartPriceRange(candles,[10],lines,true).high>100);});
test('latest effective plans, selected history and cleared plans are distinguished',()=>{const events=[{id:'a',type:'PLAN_STOP',date:'2026-01-01',price:80},{id:'b',type:'PLAN_STOP',date:'2026-02-01',price:90},{id:'c',type:'PLAN_STOP',date:'2026-03-01',price:null}];assert.deepEqual(chartPriceLines({events},'2026-02-10').map(l=>l.price),[90]);assert.equal(chartPriceLines({events},'2026-02-10','a').length,2);assert.equal(chartPriceLines({events},'2026-03-10').length,0);});
test('same price merges names; crowded and offscreen labels never overlap and keep all detail',()=>{const lines=chartPriceLines({events:[],overlays:[{price:100,label:'均價'},{price:100,label:'草稿'}]},'now');assert.equal(lines.length,1);assert.equal(lines[0].details.length,2);const many=Array.from({length:50},(_,i)=>({price:i+1,label:String(i),details:[{price:i+1}]}));const g={top:30,priceBottom:180,low:20,high:30};const labels=layoutPriceLabels(many,g);assert.equal(labels.flatMap(l=>l.details).length,50);assert.ok(labels.some(l=>l.edge));for(let i=1;i<labels.length;i++)assert.ok(labels[i].y-labels[i-1].y>=18);assert.ok(labels[0].y>=30&&labels.at(-1).y<=180);});

test('latest holdings keep current plans visible when quotes lag; historical replay never imports later plans',()=>{
 const model={status:'OPEN',windowEnd:'2026-09-24',events:[{id:'new',type:'PLAN_STOP',date:'2026-09-24',price:90}]},candles=[{date:'2026-09-23'}];
 assert.equal(chartPlanDate(model,candles,null,true),'2026-09-24');
 assert.equal(chartPriceLines(model,chartPlanDate(model,candles,null,true)).length,1);
 assert.equal(chartPlanDate(model,candles,null,false),'2026-09-23');
 assert.equal(chartPlanDate(model,candles,'new',false),'2026-09-24');
});
