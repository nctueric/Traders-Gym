import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {sessionDates,sessionState,weekEnd,tradingDay} from '../lib/rotation-calendar.mjs';
import {weightedMean,quadrant,rotationSeries,alignPeriods,rotationReadings,rotationTransitions,periodAt,priceComparison,validRotationSettings,DEFAULT_ROTATION} from '../lib/rotation-engine.mjs';
import {rotationSnapshot} from './rotation-fixture.mjs';
const periods=Array.from({length:80},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),close:100+i,benchmark:50+i*.5,complete:true}));
test('WMA uses linear oldest-to-newest weights, 33 periods warm up and flat ratios stay on center',()=>{
 assert.equal(weightedMean([1,2,3],3),14/6);assert.equal(weightedMean([1,2],3),null);
 const series=rotationSeries(periods);assert.ok(series.slice(0,32).every(p=>p.x===null));assert.equal(series[32].x,100);assert.equal(series[32].y,100);assert.equal(series[33].speed,0);assert.equal(series[33].heading,null);assert.equal(series[32].quadrant,'boundary');
});
test('quadrants and boundary are defined independently of pixel zoom',()=>{
 assert.deepEqual([[101,101],[101,99],[99,99],[99,101],[100,101]].map(p=>quadrant(...p)),['leading','weakening','lagging','improving','boundary']);
 const series=rotationSeries(periods.map((p,i)=>({...p,close:p.close*(1+i*i/10000)})));const a=series[50],b=series[51];assert.equal(b.speed,Math.hypot(b.x-a.x,b.y-a.y));assert.equal(b.heading,(Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI+360)%360);
});
test('cutoff recomputation equals historical prefix; a gap resets 33-period warmup',()=>{
 const input=periods.map((p,i)=>({...p,close:p.close*(1+Math.sin(i/9)*.2)})),full=rotationSeries(input);
 for(const length of [33,40,65,80])assert.deepEqual(rotationSeries(input.slice(0,length)),full.slice(0,length));
 input[40].close=null;const gap=rotationSeries(input);assert.ok(gap.slice(40,73).every(p=>p.x===null));assert.notEqual(gap[73].x,null);assert.equal(gap[73].speed,null);
});
test('NYSE calendar handles holidays, mourning day, shortened sessions and DST',()=>{
 assert.equal(tradingDay('2025-01-09'),false);assert.equal(tradingDay('2026-07-03'),false);assert.equal(tradingDay('2027-12-31'),true);
 assert.equal(weekEnd('2026-04-01'),'2026-04-02');assert.equal(weekEnd('2026-07-01'),'2026-07-02');
 assert.equal(sessionState(Date.parse('2026-11-27T17:59Z')).open,true);assert.equal(sessionState(Date.parse('2026-11-27T18:00Z')).open,false);
 assert.equal(sessionState(Date.parse('2026-10-21T13:30Z')).open,true);assert.equal(sessionState(Date.parse('2026-11-03T14:29Z')).open,false);assert.equal(sessionState(Date.parse('2026-11-03T14:30Z')).open,true);
});
test('missing sessions are not compressed, missing Friday never becomes a Thursday close',()=>{
 const dates=sessionDates('2026-03-30','2026-04-10'),base=dates.map(date=>({date,close:100})),asset=base.filter(b=>b.date!=='2026-04-10');
 const weekly=alignPeriods(asset,base,{start:dates[0],end:dates.at(-1),interval:'weekly'});assert.equal(weekly[0].date,'2026-04-02');assert.equal(weekly[1].close,null);
 const partial=alignPeriods(base,base,{start:dates[0],end:'2026-04-08',interval:'weekly'});assert.equal(partial.at(-1).complete,false);assert.equal(periodAt(partial,'2026-04-08').date,'2026-04-02');
});
test('readings use completed periods, surface relative gains with negative absolute return and evidence',()=>{
 const series=[{date:'2026-10-16',x:99,y:101,quadrant:'improving',complete:true},{date:'2026-10-21',x:101,y:102,quadrant:'leading',complete:false,returnMonth:-.02,relativeMonth:.04,heading:45}];
 assert.equal(rotationReadings(series,'2026-10-21').length,1);
 const live=rotationReadings(series,'2026-10-21',{preview:true});assert.ok(live.some(r=>r.text.includes('暫時：從改善進入領先')));assert.ok(live.some(r=>r.text.includes('價格仍下跌')));assert.ok(live.every(r=>r.evidence));
 const before=rotationReadings(series,'2026-10-16',{preview:true});assert.equal(before.length,1);
});
test('comparison begins at 100 and preserves missing values without future observations',()=>{
 const rows=priceComparison([{date:'2026-10-01',close:10,benchmark:5},{date:'2026-10-02',close:null,benchmark:6},{date:'2026-10-03',close:20,benchmark:10}],'2026-10-02');assert.equal(rows.length,2);assert.equal(rows[0].asset,100);assert.equal(rows[1].asset,null);
});
test('settings whitelist accepts defaults and rejects duplicate, unknown or excessive fields',()=>{
 assert.ok(validRotationSettings(DEFAULT_ROTATION));assert.ok(validRotationSettings({...DEFAULT_ROTATION,themes:['SMH','AIQ']}));for(const patch of [{themes:['SPY']},{themes:['SMH','SMH']},{tail:100},{benchmark:'AAPL'},{interval:'minute'},{secret:'x'}])assert.equal(validRotationSettings({...DEFAULT_ROTATION,...patch}),false);
});
test('23-symbol frame computation is within 150ms once history is loaded',()=>{
 const data=rotationSnapshot();const start=performance.now();for(const row of data.rows){rotationReadings(row.weekly,'2026-10-21');priceComparison(row.daily,'2026-10-21');periodAt(row.daily,'2026-10-21');}assert.ok(performance.now()-start<150);
});

test('transition history stops at the replay cutoff and never bridges gaps',()=>{
 const row=(date,q,complete=true)=>({date,x:q==='leading'?101:99,y:101,quadrant:q,complete});
 const series=[row('2026-10-01','improving'),row('2026-10-02','leading'),{date:'2026-10-03',x:null,complete:true},row('2026-10-04','improving'),row('2026-10-05','leading',false)];
 assert.equal(rotationTransitions(series,'2026-10-05').length,1);assert.equal(rotationTransitions(series,'2026-10-05',{preview:true}).length,2);assert.equal(rotationTransitions(series,'2026-10-01').length,0);
});
