// Isolated synthetic UI verification; never mounted by the app or deployed.
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {rotationSnapshot} from './rotation-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const result=await build({configFile:false,root,logLevel:'warn',resolve:{alias:{'@':root}},define:{'process.env.NODE_ENV':'"production"'},build:{write:false,target:'esnext',lib:{entry:root+'tests/rotation-ui-fixture.tsx',formats:['es'],fileName:'fixture',cssFileName:'fixture'}}});
const output=result.output||result[0].output,assets=new Map(output.map(i=>['/'+i.fileName,i.type==='chunk'?i.code:i.source]));
const snapshot=rotationSnapshot();let requests=0,fail=false,prefFail=false;
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(url.pathname==='/fixture.json')return json(snapshot);
 if(url.pathname==='/fixture/state')return json({requests});
 if(url.pathname==='/fixture/fail'){fail=url.searchParams.get('value')==='true';return json({fail});}
 if(url.pathname==='/fixture/pref-fail'){prefFail=url.searchParams.get('value')==='true';return json({prefFail});}
 if(url.pathname==='/fixture/preferences'){for await(const _chunk of req){void _chunk;}return json({ok:!prefFail},prefFail?503:200);}
 if(url.pathname==='/api/market/rotation'){requests++;if(fail)return json({error:'驗收：基準行情暫時無法使用'},502);const symbols=url.searchParams.get('symbols')?.split(',');return json({...snapshot,benchmark:url.searchParams.get('benchmark')||'SPY',rows:snapshot.rows.filter(r=>!symbols||symbols.includes(r.symbol))});}
 if(assets.has(url.pathname)){res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'text/javascript'});return res.end(assets.get(url.pathname));}
 res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TraderGym 板塊輪動 · 隔離驗收</title>${output.filter(i=>i.fileName.endsWith('.css')).map(i=>`<link rel="stylesheet" href="/${i.fileName}">`).join('')}<div id="root"></div><script type="module" src="/${output.find(i=>i.type==='chunk').fileName}"></script></html>`);
});
server.listen(3108,'127.0.0.1',()=>console.log('Rotation fixture: http://127.0.0.1:3108'));
