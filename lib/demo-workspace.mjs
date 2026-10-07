import {simpleTimestamp} from './simple-entry.mjs';
import {marketDate} from './trade-entry.mjs';
import {validDay} from './performance-history.mjs';
export const DEMO_CAPITAL=50000;
export const DEMO_CYCLE_COUNT=150;
export const DEMO_SYMBOLS=['AAPL','MSFT','2330.TW','QQQ','SPY','USDTWD=X'];
const DAY=86400000;
export function createMemoryStorage(){const rows=new Map();return {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,String(value)),removeItem:key=>rows.delete(key),clear:()=>rows.clear()};}
const validBars=(rows,symbol,now,ohlc=false)=>[...new Map((rows||[]).filter(b=>validDay(b.date)&&b.date<marketDate(now,symbol==='2330'?'TWSE':'NASDAQ')&&typeof b.close==='number'&&Number.isFinite(b.close)&&b.close>0&&(!ohlc||[b.open,b.high,b.low].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)&&b.high>=Math.max(b.open,b.low,b.close)&&b.low<=Math.min(b.open,b.close))).map(b=>[b.date,{...b,symbol}])).values()].sort((a,b)=>a.date.localeCompare(b.date));
// Prices and sessions are supplied by the market adapter; only fills are invented.
export function createDemoDataset({series={},quotes={},now=new Date().toISOString(),warnings=[]}={}) {
 const problems=[...warnings],validated={};
 const yearStart=new Date(now);yearStart.setUTCFullYear(yearStart.getUTCFullYear()-1);const firstDay=yearStart.toISOString().slice(0,10);
 for(const [symbol,payload] of Object.entries(series))validated[symbol]=validBars(payload.bars,symbol,now,['AAPL','MSFT','2330'].includes(symbol)).filter(b=>b.date>=firstDay).map(b=>({...b,source:payload.source,fetchedAt:payload.fetchedAt}));
 // The ledger's marketBars contract is OHLC only. FX and adjusted ETF closes
 // belong to their separate series/cache and must not become invalid candles.
 const marketBars=['AAPL','MSFT','2330'].flatMap(symbol=>validated[symbol]||[]);
 const bars=symbol=>validated[symbol]||[];
 const fills=[];
 const scenario=(id,symbol,side,selected,partial=false)=>{
  const currency=symbol==='2330'?'TWD':'USD',market=currency==='TWD'?'TWSE':'NASDAQ';
  if(!selected.length||selected.some(b=>!b)||new Set(selected.map(b=>b.date)).size!==selected.length){problems.push(`${symbol} 缺足夠已完成日線，略過 ${id}`);return;}
  const entry=selected[0],fx=currency==='TWD'?bars('USDTWD=X').filter(b=>b.date<=entry.date&&Date.parse(entry.date)-Date.parse(b.date)<=7*DAY).at(-1)?.close:1;
  if(!fx){problems.push(`${symbol} 缺成交日匯率，略過 ${id}`);return;}
  const quantity=Math.floor(DEMO_CAPITAL*.1*fx/entry.close);
  if(quantity<(partial?2:1)){problems.push(`${symbol} 超過示範部位預算，略過 ${id}`);return;}
  selected.forEach((bar,index)=>{
   const count=index===0?quantity:partial?(index===1?Math.floor(quantity/2):quantity-Math.floor(quantity/2)):quantity;
   const timing=simpleTimestamp(bar.date,market,now);
   fills.push({id:`demo-${id}-${index}`,accountId:currency==='TWD'?'demo-tw':'demo-us',symbol,market,currency,side:index===0?side:side==='BUY'?'SELL':'BUY',quantity:count,price:bar.close,fee:0,feeKnown:false,timestamp:timing.timestamp,tradeDate:bar.date,timeSource:timing.timeSource,source:'DEMO',note:'以歷史原始收盤價代填的示範成交；一般收盤時間代填，未模擬交易成本'});
  });
  return true;
 };
 // Each symbol owns disjoint session windows so FIFO cannot join two examples.
 // Reserve the last sessions for open positions, after every completed cycle.
 let completedCycles=0;
 for(const symbol of ['AAPL','MSFT','2330']){
  const sessions=bars(symbol).slice(0,-2),target=DEMO_CYCLE_COUNT/3,count=Math.min(target,Math.floor(sessions.length/2));
  for(let index=0;index<count;index++){
   const start=Math.floor(index*sessions.length/count),end=Math.floor((index+1)*sessions.length/count)-1;
   const partial=index%5===0&&end-start>=2,selected=partial?[sessions[start],sessions[Math.floor((start+end)/2)],sessions[end]]:[sessions[start],sessions[end]];
   if(scenario(`${symbol}-cycle-${index+1}`,symbol,symbol==='MSFT'&&index%3===2?'SELL':'BUY',selected,partial))completedCycles++;
  }
 }
 if(completedCycles<DEMO_CYCLE_COUNT)problems.push(`真實日線或成交日匯率不足，僅建立 ${completedCycles}／${DEMO_CYCLE_COUNT} 筆示範交易閉環`);
 scenario('us-position','AAPL','BUY',[bars('AAPL').at(-1)]);
 scenario('tw-position','2330','BUY',[bars('2330').at(-1)]);
 fills.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.id.localeCompare(b.id));
 const start=fills.map(f=>f.tradeDate).sort()[0];
 const cashActivities=start?[{id:'demo-fund',accountId:'demo-us',type:'OPENING_BALANCE',amount:DEMO_CAPITAL,currency:'USD',timestamp:start+'T00:00:00Z',source:'示範本金',note:'USD 50,000 示範計算起點，不代表真實資金'}]:[];
 return {version:'0.1.0',profile:{name:'TraderGym 示範帳本',baseCurrency:'USD',costMethod:'FIFO'},accounts:[{id:'demo-us',name:'示範美股帳戶',currency:'USD'},{id:'demo-tw',name:'示範台股帳戶',currency:'TWD'}],fills,cashActivities,marketBars,settings:{quoteProvider:'yahoo',benchmarkSymbol:'SPY'},strategies:[],strategyAssignments:{},positionPlans:{},cycleReviews:{},planHistory:[],entryContexts:{},demoWarnings:problems,marketSnapshot:{version:1,quotes:structuredClone(quotes),lastQuoteAt:Object.keys(quotes).length?Date.parse(now):null,benchmarkSymbol:'SPY',benchmarkBars:series.SPY?.bars||[]}};
}
export function createDemoRuntime({networkFetch=globalThis.fetch,clock=()=>Date.now(),origin=globalThis.location?.origin||'https://demo.invalid'}={}) {
 const now=()=>new Date(clock()).toISOString();
 let data=createDemoDataset({now:now()}),version=1,ready=false,pending=null,generation=0;
 const storage=createMemoryStorage(),blockedUntil=new Map();
 const user={id:'demo',name:'訪客練習',email:'',picture:'',isOwner:false,authProvider:'demo',sessionId:'demo-memory',expiresAt:'2099-01-01T00:00:00Z'};
 const reply=(body,status=200,headers={})=>Response.json(body,{status,headers});
 const transport=async(path,init={})=>{
  const key=path.split('?')[0],wait=blockedUntil.get(key)||0;
  if(clock()<wait)return reply({error:'行情請求過多，等待重試'},429,{'Retry-After':String(Math.ceil((wait-clock())/1000))});
  const response=await networkFetch(path,{method:'GET',credentials:'omit',headers:{Accept:'application/json'},cache:'no-store',signal:init.signal});
  if(response.status===429)blockedUntil.set(key,clock()+Math.max(1,Number(response.headers.get('Retry-After'))||60)*1000);
  return response;
 };
 const history=async(url,init)=>{
  const start=url.searchParams.get('start'),end=url.searchParams.get('end');
  if(!start||!end||!validDay(start)||!validDay(end)||start>end)return transport('/api/market/history'+url.search,init);
  const cutoff=now().slice(0,10),stop=end<cutoff?end:cutoff;
  if(start>stop)return reply({error:'起始日期尚未發生'},400);
  const bars=[];let metadata;
  for(let day=Date.parse(start);day<=Date.parse(stop);day+=360*DAY){
   init.signal?.throwIfAborted();
   const query=new URLSearchParams(url.searchParams);query.set('start',new Date(day).toISOString().slice(0,10));query.set('end',new Date(Math.min(day+359*DAY,Date.parse(stop))).toISOString().slice(0,10));
   const response=await transport('/api/market/history?'+query,init);if(!response.ok)return response;
   metadata=await response.json();bars.push(...(metadata.bars||[]));
  }
  return reply({...metadata,bars,firstDate:bars[0]?.date,lastDate:bars.at(-1)?.date});
 };
 const fetcher=async(input,init={})=>{
  init.signal?.throwIfAborted();
  const request=input instanceof Request?input:null,url=new URL(request?.url||String(input),origin),method=String(init.method||request?.method||'GET').toUpperCase();
  if(url.origin!==origin)return reply({error:'訪客只使用站內市場服務'},403);
  if(method==='GET'&&['/api/quotes','/api/market/quotes'].includes(url.pathname))return transport('/api/market/quotes'+url.search,{...init,signal:init.signal||request?.signal});
  if(method==='GET'&&['/api/history','/api/market/history'].includes(url.pathname))return history(url,{...init,signal:init.signal||request?.signal});
  if(url.pathname==='/api/trade-records'&&method==='GET'){
   if(!ready)return reply({error:'真實行情尚未載入'},503);
   const account={id:'demo',name:data.profile.name,version,updatedAt:now()};return reply({account,accounts:[account],dataset:structuredClone(data)});
  }
  if(url.pathname==='/api/auth/session'&&method==='GET')return reply({user});
  if(url.pathname==='/api/review-valuations'&&['GET','PUT'].includes(method))return reply(method==='GET'?{cache:null}:{ok:true});
  return reply({error:'訪客練習不使用私人或雲端寫入 API'},403);
 };
 /** @param {{signal?:AbortSignal,onProgress?:(done:number,total:number)=>void}} [options] */
 const initialize=({signal,onProgress=(done,total)=>{void done;void total;}}={})=>{
  if(ready)return Promise.resolve(data);
  if(pending)return pending;
  const run=++generation;
  pending=(async()=>{
   const asOf=now(),end=new Date(Date.parse(asOf)-DAY).toISOString().slice(0,10),startDate=new Date(end);startDate.setUTCFullYear(startDate.getUTCFullYear()-1);const start=startDate.toISOString().slice(0,10);
   const series={},warnings=[],quotes={};let completed=0;
   const targets=['AAPL','MSFT','2330.TW','USDTWD=X','QQQ','SPY'];let cursor=0;
   await Promise.all(Array.from({length:3},async()=>{while(cursor<targets.length){const provider=targets[cursor++],symbol=provider==='2330.TW'?'2330':provider;
    try {
     const query=new URLSearchParams({symbol:provider,datasetSymbol:symbol,start,end,...(['AAPL','MSFT','2330.TW'].includes(provider)?{mode:'ohlc'}:{priceBasis:provider==='USDTWD=X'?'raw':'adjusted'})});
     const response=await fetcher('/api/history?'+query,{signal}),payload=await response.json();
     if(!response.ok)throw Error(payload.error||`HTTP ${response.status}`);
     if(!Array.isArray(payload.bars)||!payload.bars.length)throw Error('無有效行情');
     series[symbol]=payload;
    }catch(error){if(signal?.aborted)throw error;warnings.push(`${provider}：${error.message}`);}
    if(run===generation&&!signal?.aborted)onProgress(++completed,targets.length);
   }}));
   signal?.throwIfAborted();
   try {const response=await fetcher('/api/quotes?symbols='+targets.join(','),{signal}),payload=await response.json();if(!response.ok)throw Error(payload.error||'報價讀取失敗');for(const quote of payload.quotes||[])quotes[quote.symbol]=quote;warnings.push(...(payload.errors||[]).map(e=>`${e.symbol}：${e.message}`));}
   catch(error){if(signal?.aborted)throw error;warnings.push(error.message);}
   signal?.throwIfAborted();
   if(run!==generation)throw new DOMException('Aborted','AbortError');
   const next=createDemoDataset({series,quotes,now:asOf,warnings});
   if(!next.fills.length)throw Error('未取得足夠真實日線，尚未建立示範成交。請重試。'+(warnings.length?' '+warnings.slice(0,3).join('；'):''));
   data=next;ready=true;return structuredClone(data);
  })().finally(()=>{if(run===generation)pending=null;});return pending;
 };
 return {user,storage,fetcher,now,initialize,reset:()=>{generation++;pending=null;ready=false;data=createDemoDataset({now:now()});version=1;storage.clear();blockedUntil.clear();},update:next=>{data=structuredClone(next);version++;},read:()=>structuredClone(data)};
}
