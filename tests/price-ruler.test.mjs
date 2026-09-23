import test from 'node:test';
import assert from 'node:assert/strict';
import {snapRulerPoint,candlePrices,rulerResult,keyboardRulerPoint} from '../lib/price-ruler.mjs';
const g={left:10,right:210,top:20,priceBottom:220,volumeBottom:300,step:100,low:0,high:200};
const bars=[{date:'2026-01-02',open:100,high:140,low:80,close:120},{date:'2026-01-05',open:110,high:160,low:90,close:130}];
const y=p=>220-p;
test('both points snap to nearest original OHLC, tie order close/open/high/low',()=>{
 for(const field of ['open','high','low','close'])assert.equal(snapRulerPoint(g,bars,60,y(bars[0][field])).field,field);
 assert.equal(snapRulerPoint(g,bars,60,y(110)).field,'close');
 assert.equal(snapRulerPoint(g,[{...bars[0],open:120,high:120,low:120}],60,y(120)).field,'close');
 assert.equal(snapRulerPoint(g,bars,160,y(110)).field,'open');
 assert.equal(snapRulerPoint(g,bars,9,80),null);assert.equal(snapRulerPoint(g,bars,60,250),null);
});
test('synthetic chart fallback prices cannot be measured',()=>{
 const bar={...bars[0],rawOhlc:{open:null,high:null,low:null,close:120}};
 assert.deepEqual(candlePrices(bar).map(p=>p.field),['close']);assert.equal(snapRulerPoint(g,[bar],60,y(140)).field,'close');
 assert.equal(snapRulerPoint(g,[{...bar,rawOhlc:{close:NaN}}],60,100),null);
});
test('signed price change uses first snapped price, supports reverse/same-candle/decimal values',()=>{
 assert.deepEqual(rulerResult({price:100},{price:120}),{difference:20,percent:20});
 assert.deepEqual(rulerResult({price:120},{price:100}),{difference:-20,percent:-20/120*100});
 assert.deepEqual(rulerResult({price:100},{price:100}),{difference:0,percent:0});
 assert.ok(Math.abs(rulerResult({price:1.01234},{price:1.11234}).difference-.1)<1e-12);
});
test('keyboard chooses chronological candles and ascending distinct OHLC values',()=>{
 let p=keyboardRulerPoint(bars,null,'initial');assert.equal(p.field,'close');assert.equal(p.index,1);
 p=keyboardRulerPoint(bars,p,'ArrowUp');assert.equal(p.field,'high');
 p=keyboardRulerPoint(bars,p,'ArrowLeft');assert.equal(p.index,0);assert.equal(p.field,'close');
 p=keyboardRulerPoint(bars,p,'ArrowDown');assert.equal(p.field,'open');
});
