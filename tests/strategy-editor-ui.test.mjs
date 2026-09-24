import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { publishStrategyVersion } from '../lib/strategy-engine.mjs';
const require=createRequire(import.meta.url);
function load(react=React,entry='strategy-workspace'){const cache=new Map();function moduleAt(name){if(cache.has(name))return cache.get(name);const code=ts.transpileModule(readFileSync(new URL(`../app/${name}.tsx`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const mod={exports:{}};cache.set(name,mod.exports);new Function('require','module','exports','window',code)(id=>id==='react'?react:id.startsWith('@/lib/')?require('../lib/'+id.slice(6)):id.startsWith('./')?moduleAt(id.slice(2)):require(id),mod,mod.exports,{confirm:()=>true});return mod.exports;}return moduleAt(entry);}
const rules=[{id:'e',name:'突破',group:'ENTRY_TRIGGER'},{id:'x',name:'失效',group:'EXIT_TRIGGER'}];
const strategy=()=>publishStrategyVersion({id:'s',name:'策略',versions:[]},rules,'','2026-01-01',{formatVersion:2,marketMode:'UNRESTRICTED'}).strategy;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const find=(tree,predicate)=>nodes(tree).find(predicate);
const text=node=>nodes(node).length?React.Children.toArray(node.props.children).filter(c=>typeof c==='string').join(''):'';
function harness(){let index=0,current={strategies:[strategy()],assignments:{},cycles:[],fxRate:32},fail=false;const hooks=[],calls=[];const react={...React,useState(initial){const i=index++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return[hooks[i],value=>{hooks[i]=typeof value==='function'?value(hooks[i]):value;}];},useRef(initial){const i=index++;return hooks[i]||={current:initial};},useMemo(fn){index++;return fn();},useEffect(){index++;}};const {StrategyWorkspace}=load(react);return {calls,set fail(value){fail=value;},render(){index=0;return StrategyWorkspace({...current,onStrategiesChange:async next=>{calls.push(structuredClone(next));current={...current,strategies:next};if(fail)throw Error('測試斷線');}});}};}

test('editor saves drafts without publishing, cancel restores, and publish after draft remains available',async()=>{
 const h=harness();let tree=h.render();find(tree,n=>n.type==='input'&&n.props.placeholder==='例如：波段突破').props.onChange({target:{value:'修改後'}});tree=h.render();await find(tree,n=>n.type==='button'&&text(n)==='儲存草稿').props.onClick();tree=h.render();assert.equal(h.calls[0][0].versions.length,1);assert.equal(find(tree,n=>n.type==='button'&&text(n)==='發布新版').props.disabled,false);
 find(tree,n=>n.type==='input'&&n.props.placeholder==='例如：波段突破').props.onChange({target:{value:'取消我'}});tree=h.render();find(tree,n=>n.type==='button'&&text(n)==='取消修改').props.onClick();tree=h.render();assert.equal(find(tree,n=>n.type==='input'&&n.props.placeholder==='例如：波段突破').props.value,'修改後');assert.equal(h.calls.length,1);
});

test('publish failure retains draft and retries identical version once; no original version mutation',async()=>{
 const h=harness();let tree=h.render();find(tree,n=>n.type==='input'&&n.props['aria-label']==='進場條件 1').props.onChange({target:{value:'新版突破'}});tree=h.render();find(tree,n=>n.type==='input'&&n.props.placeholder==='僅儲存草稿時可留空').props.onChange({target:{value:'更新訊號'}});h.fail=true;tree=h.render();await find(tree,n=>n.type==='button'&&text(n)==='發布新版').props.onClick();tree=h.render();assert.ok(find(tree,n=>n.props?.role==='alert'));assert.equal(h.calls[0][0].versions.length,2);assert.equal(h.calls[0][0].versions[0].rules[0].name,'突破');h.fail=false;await find(tree,n=>n.type==='button'&&text(n)==='重試儲存').props.onClick();tree=h.render();assert.deepEqual(h.calls[1],h.calls[0]);assert.equal(find(tree,n=>n.type==='button'&&text(n)==='發布新版').props.disabled,true);
});

test('old evidence uses shared legacy ALL review and new missing evidence stays pending',()=>{
 const {StrategyChecklist}=load();const s=strategy(),cycle={id:'c',closeAt:'2026-08-01',pnl:1};
 const html=renderToStaticMarkup(React.createElement(StrategyChecklist,{strategies:[s],cycle,assignment:{strategyId:'s',strategyVersionId:'s-v1'},phase:'post',entryContexts:{}}));assert.match(html,/成交時策略證據未記錄/);assert.match(html,/待複盤/);assert.match(html,/以上皆未符合/);
 const old={...s,versions:s.versions.map(v=>({...v,formatVersion:undefined}))};const legacy=renderToStaticMarkup(React.createElement(StrategyChecklist,{strategies:[old],cycle,assignment:{strategyId:'s',strategyVersionId:'s-v1'},phase:'post'}));assert.match(legacy,/舊版逐條判定/);assert.doesNotMatch(legacy,/以上皆未符合/);
});


test('selection buttons retain legacy status and support mutually exclusive none with multi-select',()=>{
 const {StrategyConditions}=load(React,'strategy-conditions');
 let value={checks:{}};
 const legacy={rules:[{id:'m',name:'市場訊號',group:'MARKET_CONDITION'}]};
 let tree=StrategyConditions({version:legacy,value,onChange:next=>{value=next;}});
 assert.equal(nodes(tree).some(n=>n.type==='select'),false);
 const group=find(tree,n=>n.props?.role==='group'&&n.props['aria-label']==='市場訊號確認');
 find(group,n=>n.type==='button'&&text(n)==='符合').props.onClick();
 assert.equal(value.checks.m,'CONFIRMED');
 tree=StrategyConditions({version:legacy,value,onChange:next=>{value=next;}});
 assert.equal(find(tree,n=>n.type==='button'&&text(n)==='符合').props['aria-pressed'],true);
 const version={formatVersion:2,marketMode:'UNRESTRICTED',rules:[...rules,{id:'e2',name:'拉回',group:'ENTRY_TRIGGER'}]};
 value={checks:{}};
 const render=()=>StrategyConditions({version,value,onChange:next=>{value=next;}});
 for(const name of ['突破','拉回'])find(render(),n=>n.type==='button'&&text(n)===name).props.onClick();
 assert.equal(value.checks.e,'CONFIRMED');assert.equal(value.checks.e2,'CONFIRMED');
 find(render(),n=>n.type==='button'&&text(n)==='以上皆未符合').props.onClick();
 assert.ok(value.noneGroups.includes('ENTRY_TRIGGER'));
 assert.notEqual(value.checks.e,'CONFIRMED');
 find(render(),n=>n.type==='button'&&text(n)==='突破').props.onClick();
 assert.equal(value.noneGroups.includes('ENTRY_TRIGGER'),false);
 const readonly=StrategyConditions({version,value,mode:'readonly'});
 assert.equal(nodes(readonly).some(n=>n.type==='button'),false);
});
