// Synthetic identity and isolated local D1/R2 only. Reports exclude ledger contents and credentials.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:3107';
const login=await fetch(origin+'/api/auth/password',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'cloud-check@example.test',password:'Cloud-acceptance-only-2026'})});assert.equal(login.status,200);
const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
const user=(await(await fetch(origin+'/api/auth/session',{headers:{Cookie:cookie}})).json()).user;
const headers={Cookie:cookie,'x-workspace-session':user.sessionId,Origin:origin,'Content-Type':'application/json'};
const call=async(path,method='GET',body)=>{const response=await fetch(origin+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;};
const accounts=await call('/api/ledgers');let account=accounts.accounts.find(a=>a.name==='首頁效能隔離測試'&&!a.deletedAt);
if(!account)account=(await call('/api/ledgers','POST',{action:'create',name:'首頁效能隔離測試'})).account;
const source=JSON.parse(await readFile('data/private/v2.5.1-release/r2-before/1.json','utf8'));
const originalJson=JSON.stringify(source);
account=(await call('/api/trade-records','PUT',{accountId:account.id,accountName:account.name,baseVersion:account.version,dataset:source,saveMode:'manual'})).account;
const samples=[];let bytes=0;
for(let i=0;i<200;i++){const start=performance.now(),response=await fetch(origin+`/api/workspace/bootstrap?accountId=${account.id}`,{headers});assert.equal(response.status,200);const text=await response.text(),data=JSON.parse(text);assert.equal(data.account.version,account.version);assert.ok(data.home);bytes=Buffer.byteLength(text);const timing=Object.fromEntries([...response.headers.get('Server-Timing').matchAll(/([\w]+);dur=([\d.]+)/g)].map(m=>[m[1],Number(m[2])]));samples.push({...timing,http:performance.now()-start});}
const percentile=(rows,p)=>[...rows].sort((a,b)=>a-b)[Math.ceil(rows.length*p)-1];const metrics=Object.fromEntries(Object.keys(samples[0]).map(k=>[k,{p50:percentile(samples.map(s=>s[k]),.5),p95:percentile(samples.map(s=>s[k]),.95),max:Math.max(...samples.map(s=>s[k]))}]));
const html=await(await fetch(origin+'/?accountId='+account.id,{headers})).text();assert.match(html,/data-home-assets/);assert.match(html,/首頁摘要已載入/);
const after=await call('/api/trade-records?accountId='+account.id);assert.equal(JSON.stringify(after.dataset),originalJson);
const report={at:new Date().toISOString(),environment:'localhost; actual isolated Miniflare D1/R2, not Taiwan network/production',samples:samples.length,sourceBytes:Buffer.byteLength(originalJson),barCount:source.marketBars.length,fillCount:source.fills.length,responseBytes:bytes,firstRequest:samples[0],metrics,backendP95Pass:metrics.total.p95<=100,ssrAssets:true,fullSnapshotUnchanged:true,accountId:account.id};
await mkdir('docs/acceptance/home-speed',{recursive:true});await writeFile('docs/acceptance/home-speed/local-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
