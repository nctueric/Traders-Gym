import { createStrategy, publishStrategyVersion, createStrategyAssignment } from './strategy-engine.mjs';
import { summarize } from './trade-engine.mjs';
export const DEMO_NOW='2026-09-25T20:00:00.000Z';
export function createMemoryStorage(){const rows=new Map();return {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,String(value)),removeItem:key=>rows.delete(key),clear:()=>rows.clear()};}
export function createDemoDataset(){
 const symbols=['TGYM','FOCUS','2330','QQQ','SPY','USDTWD=X'],marketBars=[];
 for(let t=Date.parse('2025-09-01'),i=0;t<=Date.parse(DEMO_NOW);t+=86400000,i++){
  const day=new Date(t);if(day.getUTCDay()===0||day.getUTCDay()===6)continue;
  symbols.forEach((symbol,index)=>{const base=[100,65,800,420,500,31.5][index],close=+(base*(1+(.00045*i)+Math.sin(i/9+index)*.035)).toFixed(4);marketBars.push({symbol,date:day.toISOString().slice(0,10),open:+(close*.996).toFixed(4),high:+(close*1.013).toFixed(4),low:+(close*.982).toFixed(4),close,volume:1000000+i*750,source:'TraderGym 合成示範'});});
 }
 const fill=(id,symbol,side,quantity,price,date)=>({id,accountId:symbol==='2330'?'demo-tw':'demo-us',symbol,market:symbol==='2330'?'TWSE':'NASDAQ',currency:symbol==='2330'?'TWD':'USD',side,quantity,price,fee:1,timestamp:date+'T15:00:00Z'});
 const fills=[fill('demo-1','TGYM','BUY',50,102,'2026-01-06'),fill('demo-2','TGYM','SELL',50,113,'2026-02-10'),fill('demo-3','FOCUS','BUY',80,73,'2026-03-03'),fill('demo-4','FOCUS','SELL',80,68,'2026-04-07'),fill('demo-5','FOCUS','SELL',40,76,'2026-05-05'),fill('demo-6','FOCUS','BUY',40,70,'2026-06-02'),fill('demo-7','TGYM','BUY',120,114,'2026-08-04'),fill('demo-8','2330','BUY',200,910,'2026-08-06')];
 const cashActivities=[{id:'demo-fund',accountId:'demo-us',type:'DEPOSIT',amount:50000,currency:'USD',timestamp:'2025-09-02T08:00:00Z'},{id:'demo-dividend',accountId:'demo-us',type:'DIVIDEND',amount:85,currency:'USD',timestamp:'2026-07-15T15:00:00Z'}];
 const rules=[{id:'entry',group:'ENTRY_TRIGGER',name:'突破整理區間',criterion:'示範條件：突破後確認量價'},{id:'exit',group:'EXIT_TRIGGER',name:'趨勢失效',criterion:'示範條件：跌破原定停損'}];
 const {strategy}=publishStrategyVersion({...createStrategy({name:'趨勢練習',rules},DEMO_NOW),id:'demo-strategy'},rules,'示範版本',DEMO_NOW,{formatVersion:2,marketMode:'UNRESTRICTED'});
 const report=summarize({fills,marketBars}),strategyAssignments=Object.fromEntries([...report.cycles,...report.positions].map(c=>[c.id,createStrategyAssignment(c,strategy,'DEMO',DEMO_NOW)]));
 const quotes=Object.fromEntries(symbols.map(symbol=>{const bars=marketBars.filter(b=>b.symbol===symbol),last=bars.at(-1),previous=bars.at(-2);const key=symbol==='2330'?'2330.TW':symbol;return [key,{symbol:key,price:last.close,previousClose:previous.close,changePct:last.close/previous.close-1,currency:symbol==='2330'?'TWD':'USD',updatedAt:DEMO_NOW,source:'合成示範・非即時行情',marketState:'CLOSED'}];}));
 return {version:'0.1.0',profile:{name:'TraderGym 示範帳本',baseCurrency:'USD',costMethod:'FIFO'},accounts:[{id:'demo-us',name:'示範美股帳戶',currency:'USD'},{id:'demo-tw',name:'示範台股帳戶',currency:'TWD'}],fills,cashActivities,marketBars,settings:{quoteProvider:'json',benchmarkSymbol:'SPY'},strategies:[strategy],strategyAssignments,positionPlans:{},cycleReviews:{},planHistory:[],entryContexts:{},marketSnapshot:{version:1,quotes,lastQuoteAt:Date.parse(DEMO_NOW),benchmarkSymbol:'SPY',benchmarkBars:marketBars.filter(b=>b.symbol==='SPY')}};
}
export function createDemoRuntime(){
 let data=createDemoDataset();let version=1;const storage=createMemoryStorage();const user={id:'demo',name:'訪客練習',email:'',picture:'',isOwner:false,authProvider:'demo',sessionId:'demo-memory',expiresAt:'2099-01-01T00:00:00Z'};
 const account=()=>({id:'demo',name:data.profile.name,version,updatedAt:DEMO_NOW});const reply=(body,status=200)=>Response.json(body,{status});
 const fetcher=async(input,init={})=>{
  if(init.signal?.aborted)throw new DOMException('Aborted','AbortError');
  const url=new URL(String(input),'https://demo.invalid'),method=init.method||'GET';
  if(url.pathname==='/api/trade-records'&&method==='GET')return reply({account:account(),accounts:[account()],dataset:structuredClone(data)});
  if(url.pathname==='/api/auth/session')return reply({user});
  if(url.pathname==='/api/quotes')return reply({quotes:(url.searchParams.get('symbols')||'').split(',').map(s=>data.marketSnapshot.quotes[s]).filter(Boolean),errors:[]});
  if(url.pathname==='/api/history'){
   const key=(url.searchParams.get('symbol')||'').replace(/\.(TW|TWO)$/,''),symbol=url.searchParams.get('datasetSymbol')||key;
   const bars=data.marketBars.filter(b=>b.symbol===key&&(!url.searchParams.get('start')||b.date>=url.searchParams.get('start'))&&(!url.searchParams.get('end')||b.date<=url.searchParams.get('end'))).map(b=>({...b,symbol}));
   return reply({bars,priceBasis:url.searchParams.get('priceBasis')||'raw',source:'TraderGym 合成示範',latestDate:bars.at(-1)?.date,live:{complete:true,tradingDate:DEMO_NOW.slice(0,10),quoteTime:DEMO_NOW}});
  }
  if(url.pathname==='/api/review-valuations')return reply(method==='GET'?{cache:null}:{ok:true});
  return reply({error:'訪客練習不使用雲端 API'},403);
 };
 return {user,storage,fetcher,now:DEMO_NOW,reset:()=>{data=createDemoDataset();version=1;storage.clear();},update:next=>{data=structuredClone(next);version++;},read:()=>structuredClone(data)};
}
