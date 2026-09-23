import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEntryDraft, previewEntry, buildEntryEvidence } from '../lib/trade-entry.mjs';

const require=createRequire(import.meta.url);
const load=(react=React,extras={})=>{
 const cache=new Map();
 function moduleAt(name) {if(cache.has(name))return cache.get(name);const code=ts.transpileModule(readFileSync(new URL('../app/'+name+'.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const mod={exports:{}};cache.set(name,mod.exports);new Function('require','module','exports','window','document','ResizeObserver','fetch',code)(id=>id==='react'?react:id.startsWith('@/lib/')?require('../lib/'+id.slice(6)):id.startsWith('./')?moduleAt(id.slice(2)):require(id),mod,mod.exports,extras.window,extras.document,extras.ResizeObserver,extras.fetch);return mod.exports;}
 return moduleAt('trade-entry-workspace');
};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const find=(tree,predicate)=>nodes(tree).find(predicate);
const initial=()=>({version:'1',profile:{name:'test'},settings:{},accounts:[{id:'usd',currency:'USD',name:'美股'}],fills:[],marketBars:[],cashActivities:[],strategies:[]});
function props(data=initial(),patch={}){return {data,draft:{...createEntryDraft(data.accounts),symbol:'AAA',quantity:'10',price:'100',timestamp:new Date(Date.now()-60000).toISOString(),...patch},quotes:{},onChange(){},onSubmit(){},onBack(){}};}
function harness(input){
 let index=0,current=input,tree;const hooks=[],effects=[],timers=new Map(),requests=[];let serial=0,submitted=0;
 const react={...React,useState(initial){const i=index++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return[hooks[i],value=>{hooks[i]=typeof value==='function'?value(hooks[i]):value;}];},useRef(initial){const i=index++;return hooks[i]||=( {current:initial});},useMemo(fn,deps){const i=index++;if(!hooks[i]||deps.some((d,j)=>!Object.is(d,hooks[i].deps[j])))hooks[i]={value:fn(),deps};return hooks[i].value;},useEffect(fn,deps){const i=index++;if(!hooks[i]||deps.some((d,j)=>!Object.is(d,hooks[i].deps[j]))){const old=hooks[i];hooks[i]={deps};effects.push(()=>{old?.cleanup?.();hooks[i].cleanup=fn();});}}};
 const document={hidden:false,addEventListener(){},removeEventListener(){}};
 const components=load(react,{document,window:{setInterval(fn,ms){timers.set(++serial,{fn,ms,interval:true});return serial;},clearInterval(id){timers.delete(id);},setTimeout(fn,ms){timers.set(++serial,{fn,ms});return serial;},clearTimeout(id){timers.delete(id);}},fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))});
 current={...current,onChange(patch){current={...current,draft:{...current.draft,...patch}};},onSubmit(){submitted++;}};
 return {render(){index=0;tree=components.TradeEntryWorkspace(current);for(const effect of effects.splice(0))effect();return tree;},get current(){return current;},get submitted(){return submitted;},document,requests,run(ms){for(const[id,item]of[...timers])if(item.ms===ms){if(!item.interval)timers.delete(id);item.fn();}},close(){for(const hook of hooks)hook?.cleanup?.();}};
}
test('compact ticket removes duplicate judgments, keeps core fields and confirms exactly one submission',()=>{
 const component=load().TradeEntryWorkspace,p=props(),html=renderToStaticMarkup(React.createElement(component,p));
 for(const text of ['entry-ticket-grid','成交與計畫登錄','策略進場','整筆持倉計畫','套用標準','持倉占比','停損資產影響','不會送出券商訂單'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/本次進場|name="entry-setup"|name="entry-volume"|加碼理由|<dialog/);
 const h=harness(p);let tree=h.render();assert.equal(find(tree,n=>n.type==='button'&&n.props.type==='submit').props.disabled,true);
 find(tree,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});tree=h.render();assert.equal(find(tree,n=>n.type==='button'&&n.props.type==='submit').props.disabled,false);
 const form=find(tree,n=>n.type==='form');form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});assert.equal(h.submitted,1);h.close();
});
test('manual stop persists and invalid stop remains editable',()=>{
 const h=harness(props());let tree=h.render();
 find(tree,n=>n.type==='input'&&n.props['aria-label']==='停損價').props.onChange({target:{value:'0'}});tree=h.render();
 assert.equal(h.current.draft.planModes.stopLoss,'MANUAL');assert.ok(find(tree,n=>n.type==='input'&&n.props.value==='0'));assert.equal(find(tree,n=>n.type==='button'&&n.props.type==='submit').props.disabled,true);h.close();
});
test('add inherits strategy and separate checks; exit hides entry checks and plan',()=>{
 const data=initial();data.fills=[{id:'a',accountId:'usd',symbol:'AAA',market:'NASDAQ',currency:'USD',side:'BUY',quantity:10,price:90,fee:0,timestamp:'2026-08-01T00:00:00Z'}];
 data.strategies=[{id:'s',name:'原策略',status:'ARCHIVED',versions:[{id:'v1',rules:[{id:'r',name:'規則A',group:'ENTRY_TRIGGER',criterion:'收盤突破'}]}]}];data.strategyAssignments={'cycle-a':{strategyId:'s',strategyVersionId:'v1'}};
 const component=load().TradeEntryWorkspace,html=renderToStaticMarkup(React.createElement(component,props(data)));
 assert.match(html,/原策略/);assert.match(html,/規則A確認/);assert.doesNotMatch(html,/加碼理由/);
 const exit=renderToStaticMarkup(React.createElement(component,props(data,{side:'SELL'})));assert.doesNotMatch(exit,/規則A確認/);assert.match(exit,/平倉後無剩餘部位/);
});
test('live refresh stays in memory, ignores aborted symbol response and pauses hidden pages',async()=>{
 const h=harness(props());let tree=h.render();h.run(400);assert.equal(h.requests.length,3);
 const old=h.requests.slice();find(tree,n=>n.type==='input'&&n.props.placeholder==='例：NVTS').props.onChange({target:{value:'BBB'}});h.render();assert.ok(old.every(r=>r.options.signal.aborted));h.run(400);
 for(const r of old)r.resolve({ok:true,json:async()=>({bars:[{symbol:'AAA',date:'2026-09-01'}],quotes:[{symbol:'AAA',price:1}]})});
 const fresh=h.requests.slice(3);for(const r of fresh)r.resolve({ok:true,json:async()=>({bars:[{symbol:'BBB',date:'2026-09-01'}],quotes:[{symbol:'BBB',price:2}]})});
 await new Promise(resolve=>setImmediate(resolve));h.render();assert.equal(h.current.draft.evidenceBars,undefined);assert.equal(h.current.draft.quoteSnapshot,undefined);assert.equal(h.current.draft.price,'100');
 const count=h.requests.length;h.document.hidden=true;h.run(30000);assert.equal(h.requests.length,count);h.document.hidden=false;h.run(30000);assert.equal(h.requests.length,count+2);h.close();
});
test('saved draft price and plan survive fresh market requests on reopen',()=>{
 const p=props(initial(),{stopLoss:'95',quoteSnapshot:{quotes:{},capturedAt:'old'}});const h=harness(p);h.render();h.run(400);assert.equal(h.requests.length,3);assert.equal(h.current.draft.stopLoss,'95');assert.equal(h.current.draft.price,'100');h.close();
});
test('canvas renders ten candles, volume, trade marker and stop/target lines at narrow and wide widths',()=>{
 const bars=Array.from({length:11},(_,i)=>({symbol:'AAA',date:`2026-08-${String(i+1).padStart(2,'0')}`,open:100+i,close:101+i,high:103+i,low:99+i,volume:1000+i}));
 const evidence=buildEntryEvidence(bars,'2026-08-12T15:00:00Z','NASDAQ','AAA');
 for(const width of [300,1000]){
  const ops=[];const ctx={};for(const name of ['scale','clearRect','fillText','beginPath','moveTo','lineTo','stroke','fillRect','setLineDash','closePath','fill'])ctx[name]=(...args)=>ops.push({name,args,color:ctx.fillStyle});
  const canvas={getBoundingClientRect:()=>({width}),getContext:()=>ctx};const react={...React,useRef:()=>({current:canvas}),useState:()=>[null,()=>{}],useMemo:fn=>fn(),useEffect:fn=>fn()};
  const components=load(react,{window:{devicePixelRatio:2},ResizeObserver:class{observe(){}disconnect(){}}});const tree=components.EntryCandles({evidence,price:115,stop:95,target:125});
  assert.equal(canvas.width,width*2);assert.equal(ops.filter(op=>op.name==='fillRect').length,21);assert.ok(ops.some(op=>op.name==='fillText'&&op.args[0]==='停損'));assert.ok(ops.some(op=>op.name==='fillText'&&op.args[0]==='停利'));assert.equal(ops.filter(op=>op.name==='fill').length,1);assert.equal(find(tree,n=>n.type==='input'&&n.props.type==='range').props.max,9);
 }
});
test('draft does not affect engine preview until explicitly submitted',()=>{
 const data=initial(),p=props(data);data.entryDraft=p.draft;assert.equal(data.fills.length,0);assert.equal(previewEntry(data,p.draft).after.quantity,10);assert.equal(data.fills.length,0);
});
