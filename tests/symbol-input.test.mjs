import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import ts from 'typescript';
import {selectTradingAccount} from '../lib/trading-accounts.mjs';

const require=createRequire(import.meta.url);
function harness(value='') {
 let index=0,serial=0,tree;const hooks=[],timers=new Map(),commits=[],effects=[];
 const react={...React,useRef(initial){return hooks[index++]??={current:initial};},useEffect(fn,deps){const i=index++;if(!hooks[i]||deps.some((v,j)=>v!==hooks[i].deps[j])){const previous=hooks[i];hooks[i]={deps};effects.push(()=>{previous?.cleanup?.();hooks[i].cleanup=fn();});}}};
 const code=ts.transpileModule(readFileSync(new URL('../app/symbol-input.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports','setTimeout','clearTimeout',code)(id=>id==='react'?react:id==='react-dom'?{flushSync:fn=>fn()}:require(id),mod,mod.exports,fn=>{timers.set(++serial,fn);return serial;},id=>timers.delete(id));
 const element={value};
 const render=(next=value)=>{value=next;index=0;tree=mod.exports.SymbolInput({value,onCommit:v=>commits.push(v)});tree.props.ref.current=element;for(const effect of effects.splice(0))effect();return tree;};
 render();
 return {element,commits,render,type(v){element.value=v;tree.props.onChange();},event(name,event={}){tree.props[name](event);},idle(){const jobs=[...timers.values()];timers.clear();for(const job of jobs)job();},close(){for(const hook of hooks)hook?.cleanup?.();},get pending(){return timers.size;}};
}
test('rapid symbol typing updates native text without any ledger commits until idle',()=>{
 const h=harness();for(const v of ['2','23','233','2330'])h.type(v);
 assert.equal(h.element.value,'2330');assert.deepEqual(h.commits,[]);assert.equal(h.pending,1);
 h.idle();assert.deepEqual(h.commits,['2330']);h.close();
});
test('composition never commits or transforms partial Chinese keyboard input',()=>{
 const h=harness();h.type('a');h.event('onCompositionStart');h.type('ㄅ');h.idle();assert.deepEqual(h.commits,[]);
 let prevented=false;h.event('onKeyDown',{key:'Enter',nativeEvent:{isComposing:true},preventDefault(){prevented=true;}});assert.ok(prevented);
 h.element.value='aapl';h.event('onCompositionEnd');h.idle();assert.deepEqual(h.commits,['AAPL']);h.close();
});
test('blur flushes once before a following click; Enter cannot submit the old symbol',()=>{
 const h=harness('AAA');h.type('bb');h.event('onBlur');assert.deepEqual(h.commits,['BB']);assert.equal(h.element.value,'BB');h.idle();assert.equal(h.commits.length,1);
 h.render('BB');h.type('aapl');let prevented=false;h.event('onKeyDown',{key:'Enter',nativeEvent:{},preventDefault(){prevented=true;}});assert.ok(prevented);assert.deepEqual(h.commits,['BB','AAPL']);h.close();
});
test('background renders preserve pending text; reset, clearing and unmount are safe',()=>{
 const h=harness('AAA');h.type('BB');h.render('AAA');assert.equal(h.element.value,'BB');h.idle();h.render('BB');h.render('MSFT');assert.equal(h.element.value,'MSFT');
 h.type('');h.event('onBlur');assert.equal(h.commits.at(-1),'');h.type('AAPL');h.close();h.idle();assert.equal(h.commits.at(-1),'');
});
test('account selection does not read price history and still respects open holdings',()=>{
 const data={accounts:[{id:'held',currency:'TWD'},{id:'usd',currency:'USD'}],fills:[{id:'a',accountId:'held',symbol:'AAPL',market:'NASDAQ',currency:'USD',side:'BUY',quantity:2,price:100,fee:0,timestamp:'2026-01-01'}],get marketBars(){throw Error('Account selection must not scan historical prices');}};
 assert.equal(selectTradingAccount(data,'AAPL','USD').id,'held');
 assert.equal(selectTradingAccount(data,'MSFT','USD').id,'usd');
 assert.equal(selectTradingAccount(data,'AAPL','USD','usd').id,'usd');
 assert.equal(selectTradingAccount(data,'',''),null);
});
