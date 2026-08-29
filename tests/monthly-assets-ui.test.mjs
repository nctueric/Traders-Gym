import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as engine from "../lib/monthly-assets.mjs";

const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL("../app/monthly-assets.tsx",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const data={fills:[{id:"a",accountId:"a",symbol:"AAA",currency:"USD",side:"BUY",quantity:10,price:10,fee:0,timestamp:"2025-01-02T00:00:00Z"}],cashActivities:[{id:"cash",currency:"USD",type:"DEPOSIT",amount:1000,timestamp:"2025-01-01T00:00:00Z"}],marketBars:[]};
const props={data,quotes:{AAA:{price:12}},fxRate:32,asOf:"2026-08-28T00:00:00Z"};
function harness(){
 let stateIndex=0,memoIndex=0,historyCalls=0;
 const states=[],memos=[];
 const react={...React,useState(initial){const i=stateIndex++;if(!(i in states))states[i]=initial;return[states[i],value=>{states[i]=value;}];},useMemo(fn,deps){const i=memoIndex++;if(!memos[i]||deps.some((dep,j)=>!Object.is(dep,memos[i].deps[j])))memos[i]={value:fn(),deps};return memos[i].value;}};
 const componentModule={exports:{}};
 new Function("require","module","exports",code)(id=>id==="react"?react:id==="@/lib/monthly-assets.mjs"?{...engine,buildMonthlyAssetHistory(...args){historyCalls++;return engine.buildMonthlyAssetHistory(...args);}}:require(id),componentModule,componentModule.exports);
 return {render(p=props){stateIndex=0;memoIndex=0;return componentModule.exports.MonthlyAssets.type(p);},get historyCalls(){return historyCalls;}};
}
function nodes(tree){return Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=="object"?[]:[tree,...nodes(tree.props?.children)];}
const find=(tree,fn)=>nodes(tree).find(fn);

test("monthly panel offers 12/24/all months and original cash evidence",()=>{
 const h=harness(),tree=h.render();
 const chart=find(tree,n=>n.type?.name==="MonthlyAssetChart");
 assert.equal(chart.props.points.length,12);
 assert.equal(chart.props.selectedMonth,"2026-08");
 const html=renderToStaticMarkup(tree);
 for(const text of ["逐月總資產變化","深色已實現＋淺色未實現＝總損益","最近12個月","最近24個月","全部月份","入金／出金原始紀錄","2026-08 總資產 USD"]){assert.ok(html.includes(text),text);}
 assert.match(html,/1,020.00/);
});
test("quote changes update current equity without recalculating historical months",()=>{
 const h=harness();h.render();assert.equal(h.historyCalls,1);
 const tree=h.render({...props,quotes:{AAA:{price:15}},asOf:"2026-08-28T00:00:30Z"});
 const chart=find(tree,n=>n.type?.name==="MonthlyAssetChart");
 assert.equal(h.historyCalls,1);
 assert.equal(chart.props.points.at(-1).totalUsd,1050);
 assert.equal(chart.props.points.at(-1).unrealizedUsd,50);
});
test("range and selected month controls drive the same detailed evidence",()=>{
 const h=harness();let tree=h.render();
 find(tree,n=>n.type==="select"&&n.props.value==="12").props.onChange({target:{value:"all"}});
 tree=h.render();let chart=find(tree,n=>n.type?.name==="MonthlyAssetChart");
 assert.equal(chart.props.points.length,20);
 chart.props.onSelect("2025-01");tree=h.render();chart=find(tree,n=>n.type?.name==="MonthlyAssetChart");
 assert.equal(chart.props.selectedMonth,"2025-01");
 const html=renderToStaticMarkup(tree);assert.match(html,/2025-01 入金／出金原始紀錄（1筆）/);assert.match(html,/2025-01-01/);
 assert.equal(h.historyCalls,1);
});
test("empty dataset shows an empty state rather than invented monthly bars",()=>{
 const h=harness(),tree=h.render({...props,data:{fills:[],cashActivities:[],marketBars:[]}});
 assert.match(renderToStaticMarkup(tree),/尚無交易或資金活動/);
 assert.equal(find(tree,n=>n.type?.name==="MonthlyAssetChart"),undefined);
});

function drawChart(points, parentWidth=600){
 const operations=[];
 const ctx={measureText:text=>({width:text.length*7})};
 for(const method of ["scale","clearRect","beginPath","moveTo","lineTo","stroke","fillRect","strokeRect","fillText","strokeText"]){
  ctx[method]=(...args)=>operations.push({method,args,fill:ctx.fillStyle,stroke:ctx.strokeStyle});
 }
 const viewport={clientWidth:parentWidth};
 const canvas={style:{},parentElement:{clientWidth:parentWidth,parentElement:viewport},getContext:()=>ctx};
 let redraw,observed;
 const react={...React,useRef:()=>({current:canvas}),useEffect:effect=>effect()};
 const componentModule={exports:{}};
 new Function("require","module","exports","window","ResizeObserver",code)(id=>id==="react"?react:id==="@/lib/monthly-assets.mjs"?engine:require(id),componentModule,componentModule.exports,{devicePixelRatio:2},class{constructor(fn){redraw=fn;}observe(target){observed=target;}disconnect(){}});
 const tree=componentModule.exports.MonthlyAssetChart({points,selectedMonth:points.at(-1)?.month,onSelect(){}});
 return {operations,canvas,tree,viewport,observed,redraw};
}
const chartPoint=(month,totalUsd)=>({month,totalUsd,baseUsd:totalUsd,depositUsd:0,withdrawalUsd:0,realizedUsd:0,unrealizedUsd:0});

test("chart replaces total ticks with rounded USD numbers without changing precision in the dataset",()=>{
 const points=[chartPoint("2026-01",1234.49),chartPoint("2026-02",1234.5),chartPoint("2026-03",-1234.5),chartPoint("2026-04",-.1),chartPoint("2026-05",null)];
 const original=structuredClone(points),{operations}=drawChart(points);
 const labels=operations.filter(op=>op.method==="strokeText").map(op=>op.args[0]);
 assert.deepEqual(labels,["1,234","1,235","-1,235","0"]);
 assert.equal(operations.filter(op=>op.method==="stroke"&&op.stroke==="#17211f").length,0);
 assert.ok(operations.some(op=>op.method==="fillText"&&op.args[0]==="缺資料"));
 assert.deepEqual(points,original);
 const lastBar=operations.findLastIndex(op=>op.method==="fillRect");
 assert.ok(operations.findIndex(op=>op.method==="strokeText")>lastBar,"totals remain on top of all adjoining bars");
});

test("month axis uses English abbreviations and a year only under January",()=>{
 const points=[chartPoint("2025-12",1000),...Array.from({length:12},(_,i)=>chartPoint(`2026-${String(i+1).padStart(2,"0")}`,1000)),{...chartPoint("2027-01",1000),isCurrent:true}];
 const {operations}=drawChart(points);
 const axis=operations.filter(op=>op.method==="fillText"&&op.args[2]>=332).map(op=>op.args[0]);
 assert.deepEqual(axis,["Dec","Jan","2026","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","2027"]);
});

test("monthly columns retain previous width and reduce gaps by 80 percent at narrow and wide sizes",()=>{
 for(const count of [1,12,24,60]){
 const points=Array.from({length:count},(_,i)=>chartPoint(`${2026+Math.floor(i/12)}-${String(i%12+1).padStart(2,"0")}`,987654321.5));
 for(const parentWidth of [320,2560]){
  const {operations,canvas,tree}=drawChart(points,parentWidth);
  const bars=operations.filter(op=>op.method==="fillRect"&&op.fill==="#bccac3");
  const minimumOriginalWidth=Math.max(600,count*("987,654,322".length*8+16)+102);
  const previousWidth=Math.max(parentWidth,minimumOriginalWidth);
  const previousStep=(previousWidth-102)/points.length;
  const step=previousStep*.6;
  const totals=operations.filter(op=>op.method==="strokeText");
  const months=operations.filter(op=>op.method==="fillText"&&op.args[2]===332);
  assert.equal(bars.length,count);
  for(let i=0;i<bars.length;i++){
   const center=82+step*(i+.5);
   assert.ok(Math.abs(bars[i].args[2]-previousStep*.5)<1e-8);
   if(i>0)assert.ok(Math.abs(bars[i].args[0]-bars[i-1].args[0]-bars[i-1].args[2]-previousStep*.5*.2)<1e-8);
   assert.ok(Math.abs(bars[i].args[0]+bars[i].args[2]/2-center)<1e-8);
   assert.ok(Math.abs(totals[i].args[1]-center)<1e-8);
   assert.ok(Math.abs(months[i].args[1]-center)<1e-8);
  }
  assert.ok(Math.abs(parseFloat(canvas.style.width)-(102+(previousWidth-102)*.6))<1e-8);
  const targets=find(tree,n=>n.props?.className==="monthly-assets-hit-columns");
  assert.equal(targets.props.style.gridTemplateColumns,`repeat(${count},minmax(0,1fr))`);
  assert.equal(canvas.width,Math.round(parseFloat(canvas.style.width)*2));
  const minWidth=102+(minimumOriginalWidth-102)*.6;
  assert.equal(find(tree,n=>n.props?.className==="monthly-assets-canvas").props.style.width,`max(${minWidth}px, calc(60% + 40.8px))`);
 }
 }
});

test("compressed chart labels do not overlap and resizing does not progressively shrink bars",()=>{
 for(const total of [987654321.5,-987654321.5]){
 const points=Array.from({length:24},(_,i)=>chartPoint(`${2026+Math.floor(i/12)}-${String(i%12+1).padStart(2,"0")}`,total));
 const h=drawChart(points,800);
 const labels=h.operations.filter(op=>op.method==="strokeText");
 for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
  const a=labels[i].args,b=labels[j].args;
  assert.ok(Math.abs(a[1]-b[1])>=(a[0].length+b[0].length)*7/2+8 || Math.abs(a[2]-b[2])>=16);
 }
 assert.equal(h.observed,h.viewport);
 const width=h.canvas.style.width;
 h.canvas.parentElement.clientWidth=parseFloat(width);
 h.redraw();h.redraw();
 assert.equal(h.canvas.style.width,width);
 h.viewport.clientWidth=4000;h.redraw();
 assert.equal(parseFloat(h.canvas.style.width),102+(4000-102)*.6);
 }
});

test("deposits are yellow, withdrawals red, and the obsolete total marker legend is removed",()=>{
 const point={...chartPoint("2026-08",1050.25),baseUsd:1000.25,depositUsd:100,withdrawalUsd:50};
 const {operations}=drawChart([point]);
 assert.ok(operations.some(op=>op.method==="fillRect"&&op.fill==="#e6bb34"));
 assert.ok(operations.some(op=>op.method==="fillRect"&&op.fill==="#d4483b"));
 const html=renderToStaticMarkup(harness().render());
 assert.doesNotMatch(html,/asset-total-mark|黑色短線/);
 assert.match(html,/四捨五入至整數美元/);
 assert.match(html,/background:#e6bb34/);
 assert.match(html,/background:#d4483b/);
 assert.match(html,/1,020\.00/);
});
