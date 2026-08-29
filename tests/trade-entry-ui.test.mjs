import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEntryDraft, previewEntry, entryEvidenceKey, buildEntryEvidence } from '../lib/trade-entry.mjs';

const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../app/trade-entry-workspace.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const load=(react=React,extras={})=>{const compiledModule={exports:{}};new Function('require','module','exports','window','ResizeObserver','fetch',code)(id=>id==='react'?react:id.startsWith('@/lib/')?require('../lib/'+id.slice(6)):require(id),compiledModule,compiledModule.exports,extras.window,extras.ResizeObserver,extras.fetch);return compiledModule.exports;};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const find=(tree,predicate)=>nodes(tree).find(predicate);
const initial=()=>({version:'1',profile:{name:'test'},settings:{},accounts:[{id:'usd',currency:'USD',name:'美股'}],fills:[],marketBars:[],cashActivities:[],strategies:[]});
function props(data=initial(),patch={}){return {data,draft:{...createEntryDraft(data.accounts),symbol:'AAA',quantity:'10',price:'100',timestamp:new Date(Date.now()-60000).toISOString(),...patch},quotes:{},onChange(){},onSubmit(){},onBack(){}};}
function harness(input){
 let index=0,current=input,tree;const hooks=[],effects=[],timers=new Map(),requests=[];let serial=0,submitted=0;
 const react={...React,useState(initial){const i=index++;if(!(i in hooks))hooks[i]=initial;return[hooks[i],value=>{hooks[i]=typeof value==='function'?value(hooks[i]):value;}];},useRef(initial){const i=index++;return hooks[i]||=( {current:initial});},useMemo(fn,deps){const i=index++;if(!hooks[i]||deps.some((d,j)=>!Object.is(d,hooks[i].deps[j])))hooks[i]={value:fn(),deps};return hooks[i].value;},useEffect(fn,deps){const i=index++;if(!hooks[i]||deps.some((d,j)=>!Object.is(d,hooks[i].deps[j]))){const old=hooks[i];hooks[i]={deps};effects.push(()=>{old?.cleanup?.();hooks[i].cleanup=fn();});}}};
 const components=load(react,{window:{setTimeout(fn,ms){timers.set(++serial,{fn,ms});return serial;},clearTimeout(id){timers.delete(id);}},fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))});
 current={...current,onChange(patch){current={...current,draft:{...current.draft,...patch}};},onSubmit(){submitted++;}};
 return {render(){index=0;tree=components.TradeEntryWorkspace(current);for(const effect of effects.splice(0))effect();return tree;},get current(){return current;},get submitted(){return submitted;},requests,run(ms){for(const[id,item]of[...timers])if(item.ms===ms){timers.delete(id);item.fn();}},close(){for(const hook of hooks)hook?.cleanup?.();}};
}
test('registration is a responsive workspace, uses single/multiple check choices and permits unplanned entries',()=>{
 const component=load().TradeEntryWorkspace,p=props(),html=renderToStaticMarkup(React.createElement(component,p));
 for(const text of ['entry-layout','成交與計畫登錄','成交前 10 日','成交前完整日線','量價觀察','未指定（待補）','整筆持倉的資產影響','相對現價資產變化','相對成本預估盈虧','不會送出券商訂單'])assert.ok(html.includes(text),text);
 assert.match(html,/type="radio" name="entry-setup"/);assert.match(html,/type="checkbox" name="entry-volume"/);assert.doesNotMatch(html,/<dialog/);
 const h=harness(p);let tree=h.render();assert.equal(find(tree,n=>n.type==='button'&&n.props.type==='submit').props.disabled,true);
 find(tree,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});tree=h.render();assert.equal(find(tree,n=>n.type==='button'&&n.props.type==='submit').props.disabled,false);
 find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(h.submitted,1);h.close();
});
test('radio replaces, multiselect preserves independent observations, and invalid stop remains editable',()=>{
 const h=harness(props());let tree=h.render();
 const choice=name=>find(tree,n=>n.type?.name==='Choices'&&n.props.name===name);
 choice('entry-setup').props.onChange('BREAKOUT');tree=h.render();choice('entry-setup').props.onChange('PULLBACK');tree=h.render();assert.equal(h.current.draft.entrySetup,'PULLBACK');
 choice('entry-volume').props.onChange(['RANGE_BREAKOUT','SUPPORT_RETEST']);tree=h.render();assert.deepEqual(h.current.draft.volumeTags,['RANGE_BREAKOUT','SUPPORT_RETEST']);
 const stopLabel=find(tree,n=>n.type==='label'&&Array.isArray(n.props.children)&&String(n.props.children[0]).includes('停損價'));find(stopLabel,n=>n.type==='input').props.onChange({target:{value:'0'}});tree=h.render();
 assert.ok(find(tree,n=>n.type==='input'&&n.props.value==='0'));assert.equal(find(tree,n=>n.type==='button'&&n.props.type==='submit').props.disabled,true);h.close();
});
test('add renders inherited strategy and independent checks; exit hides entry conditions',()=>{
 const data=initial();data.fills=[{id:'a',accountId:'usd',symbol:'AAA',market:'NASDAQ',currency:'USD',side:'BUY',quantity:10,price:90,fee:0,timestamp:'2026-08-01T00:00:00Z'}];
 data.strategies=[{id:'s',name:'原策略',status:'ARCHIVED',versions:[{id:'v1',rules:[{id:'r',name:'規則A',group:'ENTRY_TRIGGER',criterion:'收盤突破'}]}]}];data.strategyAssignments={'cycle-a':{strategyId:'s',strategyVersionId:'v1'}};
 const component=load().TradeEntryWorkspace;
 const html=renderToStaticMarkup(React.createElement(component,props(data)));
 assert.match(html,/原策略/);assert.match(html,/不改寫最初開倉檢查/);assert.match(html,/加碼理由/);assert.match(html,/收盤突破/);
 const exit=renderToStaticMarkup(React.createElement(component,props(data,{side:'SELL'})));assert.doesNotMatch(exit,/name="entry-setup"/);assert.doesNotMatch(exit,/name="entry-rule-r"/);assert.match(exit,/平倉後無剩餘部位/);
});
test('daily and quote requests run in parallel, stale response cannot change a different symbol',async()=>{
 const h=harness(props());let tree=h.render();h.run(400);assert.equal(h.requests.length,2);assert.ok(h.requests.some(r=>r.url.startsWith('/api/history')));assert.ok(h.requests.some(r=>r.url.startsWith('/api/quotes')));
 const old=h.requests.slice();find(tree,n=>n.type==='input'&&n.props.placeholder==='例：NVTS').props.onChange({target:{value:'BBB'}});h.render();assert.ok(old.every(r=>r.options.signal.aborted));h.run(400);
 old[0].resolve({ok:true,json:async()=>({bars:[{symbol:'AAA'}]})});old[1].resolve({ok:true,json:async()=>({quotes:[{symbol:'AAA',price:1}]})});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.current.draft.evidenceBars,undefined);assert.equal(h.current.draft.quoteSnapshot,undefined);
 const fresh=h.requests.slice(2);fresh[0].resolve({ok:true,json:async()=>({bars:[],fetchedAt:'now'})});fresh[1].resolve({ok:true,json:async()=>({quotes:[{symbol:'BBB',price:2}]})});await new Promise(resolve=>setImmediate(resolve));assert.equal(h.current.draft.evidenceKey,entryEvidenceKey(h.current.draft));assert.equal(h.current.draft.quoteSnapshot.quotes.BBB.price,2);h.close();
});
test('saved evidence snapshot is retained on re-open until explicit refresh',()=>{
 const p=props();p.draft.evidenceKey=entryEvidenceKey(p.draft);p.draft.evidenceBars=[];p.draft.quoteSnapshot={quotes:{},capturedAt:'old'};
 const h=harness(p),tree=h.render();h.run(400);assert.equal(h.requests.length,0);
 find(tree,n=>n.type==='button'&&n.props.children==='重新取得快照').props.onClick();h.render();h.run(400);assert.equal(h.requests.length,2);h.close();
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
