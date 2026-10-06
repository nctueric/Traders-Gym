import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../app/ledger-manager.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):!t||typeof t!=='object'?[]:[t,...nodes(t.props?.children)];
function fixture(){
 let index=0,tree,block=false,fail=false;const hooks=[],effects=[],requests=[],changes=[];
 const rows=[{id:'one',name:'第一本',version:2},{id:'two',name:'第二本',version:3},{id:'old',name:'回收帳本',version:4,deletedAt:'2026-01-01'}];
 const react={...React,useState(v){const i=index++;if(!(i in hooks))hooks[i]=v;return [hooks[i],v=>hooks[i]=typeof v==='function'?v(hooks[i]):v];},useRef(v){return hooks[index++]||=( {current:v});},useCallback(fn){index++;return fn;},useEffect(fn){const i=index++;if(!hooks[i]){hooks[i]=true;effects.push(fn);}}};
 const fetcher=async(url,options={})=>{if(!options.method)return Response.json({accounts:rows});const b=JSON.parse(options.body);requests.push(b);return fail?Response.json({error:'版本衝突'},{status:409}):Response.json({account:rows.find(r=>r.id===b.id)||{id:'new',name:b.name,version:1}});};
 const m={exports:{}};new Function('require','module','exports',code)(id=>id==='react'?react:id==='./info-popover'?{InfoPopover:()=>null}:id==='./workspace-ui'?{DialogFrame:()=>null}:id==='./mobile-ui'?{MobileDetails:({children})=>children}:require(id),m,m.exports);
 function render(){index=0;tree=m.exports.LedgerManager({embedded:true,currentId:'one',fetcher,beforeChange:async()=>{if(block)throw new Error('未同步');},onChanged:id=>changes.push(id),onClose(){}});effects.splice(0).forEach(fn=>fn());}
 return {requests,changes,get tree(){return tree;},set block(v){block=v;},set fail(v){fail=v;},render,async settle(){for(let i=0;i<4;i++){render();await new Promise(r=>setImmediate(r));}},button(label,index=0){return nodes(tree).filter(n=>n.type==='button'&&n.props.children===label)[index];},find(fn){return nodes(tree).find(fn);}};
}
test('embedded ledger selection flushes first, blocks unsynced switch, and submits select only once',async()=>{
 const h=fixture();await h.settle();assert.equal(h.button('切換').props.disabled,true);
 h.block=true;h.button('切換',1).props.onClick();await h.settle();assert.equal(h.requests.length,0);assert.ok(h.find(n=>n.props?.role==='alert'));
 h.block=false;const click=h.button('切換',1).props.onClick;click();click();await h.settle();assert.deepEqual(h.requests.map(v=>v.action),['select']);assert.deepEqual(h.changes,['two']);
});
test('rename failure retains draft; recovery uses fresh version and selects completed ledger',async()=>{
 const h=fixture();await h.settle();h.button('重新命名',1).props.onClick();await h.settle();
 h.find(n=>n.type==='input'&&n.props.value==='第二本').props.onChange({target:{value:'重新命名'}});await h.settle();h.fail=true;
 h.find(n=>n.props?.className==='ledger-confirm').props.onSubmit({preventDefault(){}});await h.settle();assert.ok(h.find(n=>n.type==='input'&&n.props.value==='重新命名'));assert.equal(h.changes.length,0);
 h.fail=false;h.find(n=>n.props?.className==='ledger-confirm').props.onSubmit({preventDefault(){}});await h.settle();assert.equal(h.requests.at(-2).baseVersion,3);assert.equal(h.requests.at(-2).name,'重新命名');assert.deepEqual(h.changes,['two']);
});
test('trash requires confirmation, restore preserves existing selection workflow',async()=>{
 const h=fixture();await h.settle();h.button('移入回收筒',1).props.onClick();await h.settle();assert.equal(h.requests.length,0);
 h.find(n=>n.props?.className==='ledger-confirm').props.onSubmit({preventDefault(){}});await h.settle();assert.equal(h.requests[0].action,'trash');assert.deepEqual(h.changes,[undefined]);
 h.button('還原').props.onClick();await h.settle();assert.deepEqual(h.requests.map(r=>r.action),['trash','restore','select']);assert.equal(h.changes.at(-1),'old');
});
