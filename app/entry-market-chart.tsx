/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import {useDemoRuntime} from './demo-context';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ReplayCanvas,EMA_STYLE} from './replay-canvas';
import {InfoPopover} from './info-popover';
import {EMA_PERIODS,emaWarmupStart} from '@/lib/chart-indicators.mjs';
import {entryChartCandles} from '@/lib/entry-market.mjs';
import {marketDate} from '@/lib/trade-entry.mjs';
import {toProviderSymbol,USDTWD_SYMBOL} from '@/lib/quote-engine.mjs';
const shift=(day:string,days:number)=>new Date(Date.parse(day+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const n=(v:any)=>v==null?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:4});
export function useEntryMarket(draft:any,data:any,quotes:any) {
 const demo=useDemoRuntime(); const fetcher=demo?.fetcher || fetch;
 const symbol=String(draft.symbol||'').trim().toUpperCase(),day=marketDate(draft.timestamp,draft.market);
 const identity=`${draft.id}:${draft.accountId}:${draft.market}:${symbol}:${day}`;
 const [clock,setClock]=useState(()=>new Date(demo?.now||Date.now())),[latest,setLatest]=useState(false),[months,setMonths]=useState(3),[revision,setRevision]=useState(0);
 const today=marketDate(clock.toISOString(),draft.market),historical=!!day&&day<today;
 const end=historical&&!latest?(shift(day,90)<today?shift(day,90):today):today;
 const start=shift(historical&&!latest?day:end,-months*31);
 const [state,setState]=useState<any>({identity:'',bars:[],quotes:{},status:'選擇標的後載入日 K'});
 const refs=useRef({quotes,data});useEffect(()=>{refs.current={quotes,data};},[quotes,data]);
 useEffect(()=>{
  if(!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)||!day)return;
  const abort=new AbortController(),provider=toProviderSymbol(symbol,draft.market);
  let busy=false,loaded=false;
  const run=async()=>{
   if(document.hidden||busy||abort.signal.aborted)return;busy=true;setClock(new Date(demo?.now||Date.now()));
   setState((old:any)=>({...old,status:'更新行情中…'}));
   const request=async(url:string)=>{const response=await fetcher(url,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])});const body=await response.json();if(!response.ok)throw new Error(body.error||'行情讀取失敗');return body;};
   try {
    const query=new URLSearchParams({symbol:provider,datasetSymbol:symbol,mode:'ohlc',start:emaWarmupStart(start),end});
    const liveQuery=new URLSearchParams({symbol:provider,datasetSymbol:symbol,mode:'ohlc',start:shift(marketDate(new Date(demo?.now||Date.now()).toISOString(),draft.market),-7),end:marketDate(new Date(demo?.now||Date.now()).toISOString(),draft.market),live:'true'});
    const jobs=await Promise.allSettled([loaded?Promise.resolve(null):request('/api/history?'+query),request('/api/history?'+liveQuery),request('/api/quotes?symbols='+encodeURIComponent(provider+','+USDTWD_SYMBOL))]);
    if(abort.signal.aborted)return;
    const history=jobs[0].status==='fulfilled'?jobs[0].value:null,live=jobs[1].status==='fulfilled'?jobs[1].value:null,quote=jobs[2].status==='fulfilled'?jobs[2].value:null;
    if(history?.bars?.length)loaded=true;
    setState((old:any)=>{
     const previous=old.identity===identity?old:{bars:refs.current.data.marketBars||[],quotes:refs.current.quotes};
     const bars=[...new Map([...previous.bars,...(history?.bars||[]),...(live?.bars||[])].filter((b:any)=>b.symbol===symbol).map((b:any)=>[b.date,b])).values()];
     const incomplete=jobs.some(j=>j.status==='rejected')||!bars.length||!quote?.quotes?.some((q:any)=>q.symbol===provider);
     return {identity,bars,quotes:{...refs.current.quotes,...previous.quotes,...Object.fromEntries((quote?.quotes||[]).map((q:any)=>[q.symbol,q]))},live:live?.live||previous.live,source:live?.source||history?.source||previous.source,fetchedAt:new Date(demo?.now||Date.now()).toISOString(),status:incomplete?'部分行情未取得；保留上次資料，可重試':demo?'合成示範行情・非即時':'每 30 秒更新・行情可能延遲'};
    });
   }catch {if(!abort.signal.aborted)setState((old:any)=>({...old,status:'行情更新失敗，可重試'}));}
   finally {busy=false;}
  };
  const timer=window.setTimeout(()=>void run(),400),interval=window.setInterval(()=>void run(),30000);
  const visible=()=>{if(!document.hidden)void run();};document.addEventListener('visibilitychange',visible);
  return()=>{abort.abort();window.clearTimeout(timer);window.clearInterval(interval);document.removeEventListener('visibilitychange',visible);};
 },[identity,symbol,day,draft.market,start,end,revision,demo,fetcher]);
 const current=state.identity===identity?state:{identity,bars:(data.marketBars||[]).filter((b:any)=>b.symbol===symbol),quotes,live:null,status:symbol?'行情載入中…':'請先輸入標的'};
 return {...current,identity,symbol,start,end,day,today,historical,latest,months,setMonths,setLatest,refresh:()=>setRevision(v=>v+1)};
}
export function EntryMarketChart({market,draft,preview,data}:{market:any;draft:any;preview:any;data:any}) {
 const [enabled,setEnabled]=useState<number[]>([...EMA_PERIODS]),[inspect,setInspect]=useState<number|null>(null),[ruler,setRuler]=useState(false),[clear,setClear]=useState(0);
 const candles=useMemo(()=>entryChartCandles(market.bars,market.symbol,market.start,market.end),[market.bars,market.symbol,market.start,market.end]);
 const selected=candles[Math.min(inspect??candles.length-1,candles.length-1)];
 const model=useMemo(()=>({symbol:market.symbol,candles,events:(data.fills||[]).filter((f:any)=>f.accountId===draft.accountId&&f.symbol===market.symbol).map((f:any)=>({id:f.id,type:f.side==='BUY'?'ENTRY':'EXIT',date:marketDate(f.timestamp,f.market),price:f.price,quantity:f.quantity,label:`已登錄${f.side==='BUY'?'買進':'賣出'}`,detail:new Date(f.timestamp).toLocaleString('zh-TW')})),overlays:[{label:'成交草稿（未保存）',source:'未保存成交',timestamp:draft.timestamp,price:Number(draft.price),color:'#368bdd',darkColor:'#8bc1ff'},{label:'操作後均價',source:'FIFO 預覽',price:preview.after?.averageCost,color:'#786099',darkColor:'#c9b8ef'},{label:'停損計畫',source:draft.standardSnapshot?.sources?.stopLoss||'目前草稿',timestamp:draft.timestamp,price:Number(draft.stopLoss),color:'#b43f35',darkColor:'#ffa59a'},{label:'停利計畫',source:draft.standardSnapshot?.sources?.takeProfit||'目前草稿',timestamp:draft.timestamp,price:Number(draft.takeProfit),color:'#176b50',darkColor:'#8bd6b4'}],chartLabel:`${market.symbol} 日 K、成交量與 EMA；含未保存成交草稿`}),[market.symbol,candles,data.fills,draft.accountId,draft.price,draft.stopLoss,draft.takeProfit,draft.timestamp,draft.standardSnapshot?.sources?.stopLoss,draft.standardSnapshot?.sources?.takeProfit,preview.after?.averageCost]);
 return <section className="entry-chart-panel"><div className="entry-section-title"><h3>市況與計畫</h3><InfoPopover label="K 線與行情"><p>日 K、成交量、EMA 10／21／50 與複盤共用。行情來自 {market.source||'Yahoo Finance'}，可能延遲；未收盤資料會變動。</p><p>虛線為本次成交草稿、操作後均價與計畫；成交草稿尚未保存。歷史成交標記可點按查看。</p><p>價格範圍預設以 K 棒與啟用均線為主；範圍外價位顯示方向箭頭，可切換「顯示全部價位」。</p><p>缺少完整 OHLC 時不補造 K 棒；EMA 不足期數時不繪製。成交量為公開行情，不代表法人籌碼。</p></InfoPopover><div className="entry-chart-periods">{[1,3,6].map(m=><button type="button" key={m} aria-pressed={market.months===m} onClick={()=>market.setMonths(m)}>{m}月</button>)}</div><button type="button" className="ghost" onClick={market.refresh}>更新</button></div>
 {market.historical&&<div className="entry-history-note"><span>{market.latest?'最新市況；不作歷史成交證據':'歷史補登：成交日後走勢為事後資訊'}</span><button type="button" onClick={()=>market.setLatest(!market.latest)}>{market.latest?'定位成交日':'回到最新'}</button></div>}
 <div className="ema-controls">{EMA_PERIODS.map(p=><button type="button" key={p} aria-pressed={enabled.includes(p)} onClick={()=>setEnabled(enabled.includes(p)?enabled.filter(v=>v!==p):[...enabled,p])}><i style={{borderTopColor:EMA_STYLE[p].color,borderTopStyle:p===10?'solid':p===21?'dashed':'dotted'}}/>EMA {p}</button>)}<button type="button" aria-pressed={ruler} onClick={()=>setRuler(!ruler)}>價格量尺</button>{ruler&&<button type="button" onClick={()=>setClear(v=>v+1)}>清除量尺</button>}</div>
 {candles.length?<ReplayCanvas model={model} cursor={candles.length-1} selectedEventId={null} enabledEma={enabled} currency={preview.fill?.currency||'USD'} emaCandle={selected} rulerEnabled={ruler} rulerClear={clear} onExitRuler={()=>setRuler(false)} onSelectMarker={()=>{}} onInspect={setInspect}/>:<div className="entry-chart-empty">{market.symbol?'尚無有效日 K，可重試或繼續登錄':'選擇標的，查看 K 線與成交量'}</div>}
 <div className="entry-chart-readout"><b>{selected?.date||'—'} {selected&&market.live&&selected.date===market.live.tradingDate?(market.live.sessionComplete===false?'未收盤':market.live.sessionComplete===true?'已收盤':'收盤狀態未知'):''}</b>{[['開',selected?.open],['高',selected?.high],['低',selected?.low],['收',selected?.close],['量',selected?.volume]].map(([label,value])=><span key={label}>{label} {n(value)}</span>)}<span>量比 {n(selected?.volumeRatio)}</span></div>
 <div className="entry-chart-status">{market.status?.includes('未取得')&&<button type="button" className="text-button" onClick={market.refresh}>行情不完整・重試</button>}<InfoPopover label="行情狀態"><p>{market.status}</p>{market.live?.quoteTime&&<p>{new Date(market.live.quoteTime).toLocaleString('zh-TW')}</p>}</InfoPopover></div></section>;
}
