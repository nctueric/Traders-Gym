import test from "node:test";
import assert from "node:assert/strict";
import { buildMonthlyAssetHistory, buildMonthlyAssetPoint, monthlyAssetSegments, withMonthlyChanges } from "../lib/monthly-assets.mjs";
import { buildCurrentEquity } from "../lib/portfolio-engine.mjs";

const now=new Date("2026-04-20T12:00:00Z");
const fill=(id,date,side,quantity,price,extra={})=>({id,timestamp:date+"T00:00:00Z",side,quantity,price,fee:0,symbol:"AAA",accountId:"a",currency:"USD",...extra});
const cash=(id,date,type,amount,extra={})=>({id,timestamp:date+"T00:00:00Z",type,amount,currency:"USD",...extra});
const bar=(date,close,extra={})=>({symbol:"AAA",date,close,...extra});
function dataset(){return {fills:[fill("entry","2026-01-10","BUY",10,20),fill("partial","2026-02-10","SELL",5,30),fill("exit","2026-03-10","SELL",5,30)],cashActivities:[cash("start","2026-01-01","DEPOSIT",1000),cash("add","2026-02-02","DEPOSIT",200),cash("withdraw","2026-02-03","WITHDRAWAL",100,{note:"可核對的提款"})],marketBars:[bar("2026-01-30",25),bar("2026-02-27",28),bar("2026-03-31",1000),bar("2026-05-01",2000)]};}

test("month-end equity avoids future bars and live prices",()=>{
 const row=buildMonthlyAssetPoint(dataset(),"2026-01",32,{AAA:{price:9999}},now);
 assert.equal(row.totalUsd,1050);assert.equal(row.realizedUsd,0);assert.equal(row.unrealizedUsd,50);
 assert.equal(row.depositUsd,1000);assert.equal(row.baseUsd,0);assert.equal(row.asOf,"2026-01-31");
});
test("monthly deposits/withdrawals stay separate from cumulative closed P&L",()=>{
 const rows=buildMonthlyAssetHistory(dataset(),32,now);
 assert.deepEqual(rows.map(row=>row.month),["2026-01","2026-02","2026-03"]);
 assert.deepEqual(rows.map(row=>row.totalUsd),[1050,1190,1200]);
 assert.deepEqual([rows[1].depositUsd,rows[1].withdrawalUsd,rows[1].realizedUsd,rows[1].unrealizedUsd,rows[1].baseUsd],[200,100,0,40,1050]);
 assert.equal(rows[1].flows[1].note,"可核對的提款");
 assert.equal(rows[2].realizedUsd,100);assert.equal(rows[2].unrealizedUsd,0);
});
test("signed bands sum to the exact equity and never double-count total P&L",()=>{
 for(const point of buildMonthlyAssetHistory(dataset(),32,now)){
   const segments=monthlyAssetSegments(point);
   assert.equal(segments.at(-1).to,point.totalUsd);
   assert.equal(segments.reduce((sum,s)=>sum+s.value,0),point.totalUsd);
   assert.equal(segments.some(s=>s.key==="pnlUsd"),false);
   assert.equal(point.realizedUsd+point.unrealizedUsd,point.pnlUsd);
 }
 const feb=monthlyAssetSegments(buildMonthlyAssetPoint(dataset(),"2026-02",32,{},now));
 assert.equal(feb.find(s=>s.key==="withdrawalUsd").value,-100);
});
test("short position losses and negative equity retain downward direction",()=>{
 const data={fills:[fill("short","2026-01-02","SELL",10,20)],cashActivities:[cash("cash","2026-01-01","DEPOSIT",100)],marketBars:[bar("2026-01-30",40)]};
 const point=buildMonthlyAssetPoint(data,"2026-01",32,{},now);
 assert.equal(point.totalUsd,-100);assert.equal(point.unrealizedUsd,-200);
 const loss=monthlyAssetSegments(point).find(s=>s.key==="unrealizedUsd");
 assert.equal(loss.from,100);assert.equal(loss.to,-100);assert.equal(loss.color,loss.negative);
});
test("months with no trades/flows are continuous and retain balances",()=>{
 const rows=buildMonthlyAssetHistory({fills:[],cashActivities:[cash("cash","2026-01-01","DEPOSIT",500)],marketBars:[]},32,now);
 assert.equal(rows.length,3);assert.deepEqual(rows.map(row=>row.totalUsd),[500,500,500]);
 assert.deepEqual(withMonthlyChanges(rows).map(row=>row.changeUsd),[null,0,0]);
});
test("unknown opening capital stays a gap and cannot fabricate monthly growth",()=>{
 const data={fills:[fill("a","2026-01-01","BUY",1,100)],cashActivities:[cash("opening","2026-03-01","OPENING_BALANCE",500)],marketBars:[bar("2026-01-31",110),bar("2026-03-31",120)]};
 const points=withMonthlyChanges(buildMonthlyAssetHistory(data,32,now));
 assert.equal(points[0].totalUsd,null);assert.match(points[0].problems.join(),/缺期初資金/);
 assert.deepEqual(monthlyAssetSegments(points[0]),[]);
 assert.equal(points[2].totalUsd,620);assert.equal(points[2].depositUsd,0);assert.equal(points[2].changeUsd,null);
});
test("uniform USD/TWD translation is explicit and missing FX suppresses misleading stacks",()=>{
 const data={fills:[fill("tw","2026-01-02","BUY",1,320,{symbol:"2330",currency:"TWD",accountId:"tw"})],cashActivities:[cash("cash","2026-01-01","DEPOSIT",640,{currency:"TWD"})],marketBars:[bar("2026-01-31",352,{symbol:"2330"})]};
 const point=buildMonthlyAssetPoint(data,"2026-01",32,{},now);
 assert.equal(point.totalUsd,21);assert.equal(point.unrealizedUsd,1);assert.equal(point.depositUsd,20);
 const missing=buildMonthlyAssetPoint(data,"2026-01",null,{},now);
 assert.equal(missing.totalUsd,null);assert.deepEqual(monthlyAssetSegments(missing),[]);
});
test("unknown cash currency is visible rather than silently excluded",()=>{
 const data=dataset();data.cashActivities.push(cash("unknown","2026-02-02","DEPOSIT",100,{currency:null,requiresReview:true}));
 const point=buildMonthlyAssetPoint(data,"2026-02",32,{},now);
 assert.equal(point.totalUsd,null);assert.equal(point.depositUsd,null);assert.ok(point.problems.length);
});
test("cash fees and adjustments are not mislabeled as new investment performance",()=>{
 const data={fills:[],marketBars:[],cashActivities:[cash("open","2026-01-01","OPENING_BALANCE",1000),cash("fee","2026-01-02","FEE",10),cash("adjust","2026-01-03","WITHDRAWAL",100,{note:"合併帳本現金校正"})]};
 const point=buildMonthlyAssetPoint(data,"2026-01",32,{},now);
 assert.equal(point.totalUsd,890);assert.equal(point.baseUsd,990);assert.equal(point.pnlUsd,0);assert.equal(point.depositUsd,0);assert.equal(point.withdrawalUsd,100);
 assert.equal(point.flows.length,1);
});
test("reversal and position history do not mutate cash or source datasets",()=>{
 const data=dataset();data.fills.push(fill("reverse","2026-03-15","SELL",20,30,{fee:2}));
 const before=JSON.stringify(data);const expected=buildCurrentEquity(data,{AAA:{price:25}},32,now);
 const current=buildMonthlyAssetPoint(data,"2026-04",32,{AAA:{price:25}},now);
 assert.equal(current.totalUsd,expected.totalUsd);assert.equal(JSON.stringify(data),before);
 assert.equal(monthlyAssetSegments(current).at(-1).to,current.totalUsd);
});
test("estimated and stale month-end values disclose their evidence limits",()=>{
 const noBars=dataset();noBars.marketBars=[];
 assert.deepEqual(buildMonthlyAssetPoint(noBars,"2026-01",32,{},now).estimatedSymbols,["AAA"]);
 const stale=dataset();stale.marketBars=[bar("2026-01-10",20)];
 assert.deepEqual(buildMonthlyAssetPoint(stale,"2026-02",32,{},now).staleSymbols,["AAA"]);
});
test("future cash/fills do not enter historical snapshots, empty data has no history",()=>{
 const data=dataset();data.cashActivities.push(cash("future","2027-01-01","DEPOSIT",99999));
 data.fills.push(fill("future","2027-01-02","BUY",1,100));
 assert.equal(buildMonthlyAssetPoint(data,"2026-04",32,{},now).totalUsd,1200);
 assert.deepEqual(buildMonthlyAssetHistory({fills:[],cashActivities:[],marketBars:[bar("2025-01-01",1)]},32,now),[]);
});
