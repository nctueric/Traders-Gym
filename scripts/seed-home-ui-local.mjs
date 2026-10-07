// Disposable synthetic ledger for screenshots; never sends production data.
import assert from 'node:assert/strict';
import {fixtureDataset} from '../tests/ui-fixture-data.mjs';
const origin='http://127.0.0.1:3107';const login=await fetch(origin+'/api/auth/password',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'cloud-check@example.test',password:'Cloud-acceptance-only-2026'})});assert.equal(login.status,200);
const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');const user=(await(await fetch(origin+'/api/auth/session',{headers:{Cookie:cookie}})).json()).user;
const headers={Cookie:cookie,'x-workspace-session':user.sessionId,Origin:origin,'Content-Type':'application/json'};
const call=async(path,body)=>{const r=await fetch(origin+path,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok);return r.json();};
const account=(await call('/api/ledgers',{action:'create',name:'介面驗收・示範帳本'})).account;
const dataset=fixtureDataset('rich');dataset.marketSnapshot={version:1,quotes:{'AAA':{price:110,updatedAt:new Date().toISOString(),source:'隔離測試固定夾具'},'2330.TW':{price:1000,updatedAt:new Date().toISOString(),source:'隔離測試固定夾具'},'USDTWD=X':{price:32,updatedAt:new Date().toISOString(),source:'隔離測試固定夾具'}}};
const r=await fetch(origin+'/api/trade-records',{method:'PUT',headers,body:JSON.stringify({accountId:account.id,accountName:account.name,baseVersion:account.version,dataset})});assert.ok(r.ok,await r.text());console.log(origin+'/?accountId='+account.id);
