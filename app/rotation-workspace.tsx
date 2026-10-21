/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import {useEffect,useMemo,useRef,useState,useId} from 'react';
import {useWorkspacePreferences} from './workspace-preferences';
import {DEFAULT_ROTATION,ROTATION_UNIVERSE,SECTOR_SYMBOLS,QUADRANTS,rotationReadings,rotationTransitions,periodAt,priceComparison} from '@/lib/rotation-engine.mjs';
import {mergeRotationSnapshot,shouldRefreshRotation,visibleRotationSeries} from '@/lib/rotation-client.mjs';
import './rotation.css';
const colors:Record<string,string>={leading:'#176b50',weakening:'#866012',lagging:'#a8463b',improving:'#296a94',boundary:'#53645c'};
const n=(value:number|null|undefined)=>value==null?'—':value.toFixed(2);
const pct=(value:number|null|undefined)=>value==null?'—':`${value>=0?'+':''}${(value*100).toFixed(2)}%`;
const time=(date:string|undefined)=>date?new Date(date).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'—';
function pathFor(points:any[],x:(v:number)=>number,y:(v:number)=>number,key='y',xKey='x') {
 let connected=false;return points.map(p=>{if(p[key]==null||p[xKey]==null){connected=false;return '';}
 const part=`${connected?'L':'M'}${x(p[xKey]).toFixed(2)},${y(p[key]).toFixed(2)}`;connected=true;return part;}).join(' ');
}
export default function RotationWorkspace() {
 const prefs=useWorkspacePreferences();
 if(!prefs.ready)return <section className="panel" role="status">正在載入研究設定…</section>;
 return <RotationContent preferences={prefs}/>;
}
export function RotationContent({preferences,initialData=null,fetcher=fetch}:{preferences:any;initialData?:any;fetcher?:typeof fetch}) {
 const [settings,setSettings]=useState<any>(()=>({...DEFAULT_ROTATION,...preferences.preferences.rotation}));
 const [saveError,setSaveError]=useState(''),[saving,setSaving]=useState(false),[data,setData]=useState<any>(initialData),[error,setError]=useState(''),[loading,setLoading]=useState(!initialData);
 const [selected,setSelected]=useState('XLK'),[isolated,setIsolated]=useState(false),[cursor,setCursor]=useState<string|null>(null),[playing,setPlaying]=useState(false),[zoom,setZoom]=useState(1),[quadrantFilter,setQuadrantFilter]=useState('all');
 const [sort,setSort]=useState({key:'y',descending:true}),[retry,setRetry]=useState(0),[expandedThemes,setExpandedThemes]=useState(false);
 const latest=cursor===null,latestRef=useRef(latest),requestRef=useRef<AbortController|null>(null);
 useEffect(()=>{latestRef.current=latest;if(!latest)requestRef.current?.abort();},[latest]);
 const symbols=useMemo(()=>[...SECTOR_SYMBOLS,...settings.themes].sort(),[settings.themes]);const symbolKey=symbols.join(',');
 const queryKey=`${settings.benchmark}:${symbolKey}`;
 const keyRef=useRef(queryKey);const skipFirst=useRef(Boolean(initialData));
 useEffect(()=>{
  let active=true,running=false,controller:AbortController|null=null,initialized=skipFirst.current;
  const changed=keyRef.current!==queryKey;keyRef.current=queryKey;
  if(changed){setData(null);setCursor(null);setPlaying(false);setZoom(1);}skipFirst.current=false;
  async function load(mode:string) {
   if(running||document.visibilityState==='hidden')return;running=true;controller=new AbortController();requestRef.current=controller;setLoading(true);
   try {
    const response=await fetcher(`/api/market/rotation?${new URLSearchParams({benchmark:settings.benchmark,symbols:symbolKey,mode})}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]),cache:'no-store',credentials:'omit'});
    const body=await response.json();if(!response.ok)throw Error(body.error||'輪動行情讀取失敗');
    if(active){setData((previous:any)=>mergeRotationSnapshot(previous,body));setError('');initialized=true;}
   }catch(e){if(active&&!controller.signal.aborted)setError(e instanceof Error?e.message:'行情更新失敗');}
   finally{running=false;if(active)setLoading(false);}
  }
  if(!initialized||changed||retry)void load('history');
  let wasOpen=shouldRefreshRotation({visible:true,latest:true});
  const refresh=()=>{const open=shouldRefreshRotation({visible:true,latest:true});const justClosed=wasOpen&&!open;wasOpen=open;if((justClosed&&latestRef.current&&document.visibilityState==='visible')||shouldRefreshRotation({visible:document.visibilityState==='visible',latest:latestRef.current})||(!initialized&&document.visibilityState==='visible'))void load(initialized?'latest':'history');};
  const visible=()=>{if(document.visibilityState==='hidden'){controller?.abort();setPlaying(false);}else refresh();};
  const timer=window.setInterval(refresh,60000);document.addEventListener('visibilitychange',visible);
  return()=>{active=false;controller?.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[queryKey,settings.benchmark,symbolKey,retry,fetcher]);
 const changeSettings=(patch:any)=>{const next={...settings,...patch};setSettings(next);if(![...SECTOR_SYMBOLS,...next.themes].includes(selected))setSelected('XLK');setSaving(true);setSaveError('');if(patch.interval){setCursor(null);setPlaying(false);setZoom(1);}void preferences.update({rotation:next}).catch((e:Error)=>setSaveError(e.message)).finally(()=>setSaving(false));};
 const rows=useMemo(()=>data?.rows?.filter((r:any)=>symbols.includes(r.symbol))||[],[data,symbols]);
 const dates=useMemo<string[]>(()=>[...new Set<string>(rows.flatMap((r:any)=>r[settings.interval].filter((p:any)=>p.complete||(latest&&settings.preview)).map((p:any)=>p.date)))].sort(),[rows,settings.interval,settings.preview,latest]);
 const date=cursor??dates.at(-1)??'',index=Math.max(0,dates.indexOf(date));
 const move=(i:number)=>{setCursor(dates[Math.max(0,Math.min(dates.length-1,i))]||null);setPlaying(false);};
 useEffect(()=>{if(!playing)return;const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;const id=window.setInterval(()=>setCursor(current=>{const at=dates.indexOf(current||dates[0]);if(at>=dates.length-1){setPlaying(false);return current;}return dates[at+1];}),reduce?2000:800);return()=>window.clearInterval(id);},[playing,dates]);
 const viewRows=useMemo(()=>rows.map((r:any)=>{const series=visibleRotationSeries(r,settings.interval,date,latest&&settings.preview);const last=series.at(-1);return {...r,series,point:last?.date===date&&last.x!=null&&!(latest&&r.stale)?last:null};}),[rows,settings.interval,date,latest,settings.preview]);
 const visibleRows=viewRows.filter((r:any)=>(!isolated||r.symbol===selected)&&(quadrantFilter==='all'||r.point?.quadrant===quadrantFilter));
 const chosen=viewRows.find((r:any)=>r.symbol===selected),point=chosen?.point;
 const readings=chosen?rotationReadings(chosen[settings.interval],date,{preview:latest&&settings.preview}):[];
 const other=chosen?periodAt(chosen[settings.interval==='weekly'?'daily':'weekly'],date,{preview:false}):null;
 const table=useMemo(()=>[...visibleRows].sort((a:any,b:any)=>{if(!a.point)return b.point?1:a.symbol.localeCompare(b.symbol);if(!b.point)return -1;const av=sort.key==='symbol'?a.symbol:sort.key==='quadrant'?QUADRANTS[a.point.quadrant as keyof typeof QUADRANTS]:a.point[sort.key],bv=sort.key==='symbol'?b.symbol:sort.key==='quadrant'?QUADRANTS[b.point.quadrant as keyof typeof QUADRANTS]:b.point[sort.key];if(av==null)return bv==null?0:1;if(bv==null)return -1;const diff=typeof av==='string'?av.localeCompare(bv):av-bv;return (sort.descending?-1:1)*diff||a.symbol.localeCompare(b.symbol);}),[visibleRows,sort]);
 const scopeKey=`${queryKey}:${settings.interval}`;
 const chartRows=visibleRows.map((r:any)=>({...r,tail:r.series.slice(-settings.tail)}));
 const [scale,setScale]=useState({key:scopeKey,radius:5});
 const needed=Math.max(2,...chartRows.flatMap((r:any)=>r.tail.filter((p:any)=>p.x!=null).flatMap((p:any)=>[Math.abs(p.x-100),Math.abs(p.y-100)])))*1.2;
 // Expand only using the current/past frame, never future points. Do not shrink while playing.
 const radius=scale.key===scopeKey?Math.max(scale.radius,needed):Math.max(5,needed);
 if(scale.key!==scopeKey||scale.radius<needed)setScale({key:scopeKey,radius:Math.max(5,needed)});
 const counts=Object.keys(QUADRANTS).filter(k=>k!=='boundary').map(k=>({key:k,label:QUADRANTS[k as keyof typeof QUADRANTS],count:viewRows.filter((r:any)=>r.point?.quadrant===k).length}));
 const closePreview=()=>{setPlaying(false);setCursor(null);setRetry(v=>v+1);};
 return <section className="rotation-workspace" aria-labelledby="rotation-title">
  <div className="rotation-heading"><div><h1 id="rotation-title">板塊輪動</h1><p>看見領先、失速與正在改善的市場主題。</p></div><details className="rotation-method"><summary>如何閱讀</summary><div><h3>先看方向，再看價格</h3><p>右側表示相對強弱趨勢較高；上方表示相對動能增加。領先不保證上漲，也不保證依序走完四象限。</p><p>同圖所有標的共用基準。主題 ETF 可能重疊，也可能持有非美國企業。SHV 仍是相對比較基準。</p><p>強弱＝100 × WMA(RS,10) ÷ WMA(RS,30)；動能＝100 × 本期強弱 ÷ 三期前強弱；RS＝調整價 ÷ 基準調整價。至少 33 期連續有效資料。</p><p>版本 tg-rotation-v1，日週各自計算。這是自有算法，不等同原版 JdK RRG，也未宣稱具有交易優勢。回放使用供應商目前的調整價格，可能因歷史修訂改變。</p></div></details></div>
  <div className="rotation-controls">
   <label>比較基準<select aria-label="比較基準" value={settings.benchmark} onChange={e=>changeSettings({benchmark:e.target.value})}>{['SPY','QQQ','SHV'].map(s=><option key={s}>{s}</option>)}</select></label>
   <label>觀察週期<select aria-label="觀察週期" value={settings.interval} onChange={e=>changeSettings({interval:e.target.value})}><option value="weekly">週線 · 趨勢</option><option value="daily">日線 · 近期變化</option></select></label>
   <label>歷史尾跡<select aria-label="歷史尾跡" value={settings.tail} onChange={e=>changeSettings({tail:Number(e.target.value)})}>{[6,12,24].map(n=><option key={n} value={n}>{n} 期</option>)}</select></label>
   <button className="ghost" aria-expanded={expandedThemes} onClick={()=>setExpandedThemes(v=>!v)}>主題圖層 {settings.themes.length}/12</button>
   <label className="rotation-check"><input type="checkbox" checked={settings.preview} onChange={e=>{setCursor(null);setPlaying(false);changeSettings({preview:e.target.checked});}}/>盤中預覽</label>
   <button className="ghost" disabled={loading||!latest} onClick={()=>setRetry(v=>v+1)}>{loading?'更新中…':'更新行情'}</button>
  </div>
  {expandedThemes&&<fieldset className="rotation-themes"><legend>疊加主題 ETF · 與板塊共用 {settings.benchmark} 基準</legend>{ROTATION_UNIVERSE.filter(r=>r.kind==='theme').map(r=><label key={r.symbol}><input type="checkbox" checked={settings.themes.includes(r.symbol)} onChange={e=>changeSettings({themes:e.target.checked?[...settings.themes,r.symbol]:settings.themes.filter((s:string)=>s!==r.symbol)})}/><span><b>{r.symbol}</b> {r.name}</span></label>)}</fieldset>}
  {(saving||saveError||preferences.status)&&<div className="rotation-save" role="status">{saveError?`設定尚未儲存：${saveError}`:saving?'正在儲存研究設定…':preferences.status}{saveError&&<button className="ghost" onClick={()=>changeSettings({})}>重試儲存</button>}</div>}
  <div className="rotation-freshness"><span>{latest?'最新模式':'歷史回放'} · {data?.marketOpen?'美股交易時段':'休市／非正常交易時段'} · 可能延遲</span><span>行情 {time(data?.quoteTime)} · 更新 {time(data?.fetchedAt)}（台北）</span></div>
  {error&&<div className="rotation-error" role="alert">{error}。{data?'已保留上次結果，資料可能過期。':'請稍後重試。'}<button className="ghost" onClick={()=>setRetry(v=>v+1)}>重試</button></div>}
  {(data?.errors?.length>0||data?.warnings?.length>0)&&<details className="rotation-warnings" open><summary>部分資料需要留意</summary>{[...data.errors,...data.warnings].map((e:any)=><p key={e.symbol}>{e.symbol}：{e.message}</p>)}</details>}
  {!data?<div className="rotation-empty" role="status"><h2>{loading?'正在建立輪動圖':'尚無可用行情'}</h2><p>讀取三年歷史資料並計算日／週相對強弱。缺少的價格會保留為缺口。</p></div>:<>
   <div className="rotation-main"><div className="rotation-plot-area">
    <div className="rotation-plot-header"><div><h2>{settings.interval==='weekly'?'週線':'日線'}輪動 <span>{date||'尚無有效日期'}</span></h2><span className="rotation-legend">圓點：板塊 · 菱形：主題 · 空心／虛線：未完成</span></div><div className="rotation-zoom"><button className="ghost" aria-label="縮小輪動圖" disabled={zoom<=1} onClick={()=>setZoom(v=>Math.max(1,v/1.4))}>−</button><button className="ghost" aria-label="放大輪動圖" disabled={zoom>=4} onClick={()=>setZoom(v=>Math.min(4,v*1.4))}>＋</button><button className="ghost" onClick={()=>setZoom(1)}>全圖</button></div></div>
    <div className="rotation-chart-scroll" role="region" aria-label="輪動圖，可左右捲動查看所有象限" tabIndex={0}><RotationPlot rows={chartRows} selected={selected} onSelect={setSelected} radius={radius/zoom} date={date}/></div><p className="rotation-pan-hint">左右滑動查看全圖；也可從下方排名選取標的。</p>
    <div className="rotation-quadrants" aria-label="象限篩選"><button aria-pressed={quadrantFilter==='all'} onClick={()=>setQuadrantFilter('all')}>全部</button>{counts.map(c=><button key={c.key} aria-pressed={quadrantFilter===c.key} onClick={()=>setQuadrantFilter(c.key)}><span style={{color:colors[c.key]}}>{c.label}</span> {c.count}</button>)}</div>
    <div className="rotation-timeline"><div><button className="ghost" disabled={!dates.length} onClick={()=>{if(playing){setPlaying(false);return;}if(latest||index===dates.length-1){setCursor(dates[0]);setScale({key:scopeKey,radius:5});}setPlaying(true);}}>{playing?'暫停':'播放歷史'}</button><button className="ghost" aria-label="上一期" disabled={!dates.length||index===0} onClick={()=>move(index-1)}>上一期</button><button className="ghost" aria-label="下一期" disabled={!dates.length||index===dates.length-1} onClick={()=>move(index+1)}>下一期</button><button className="ghost" onClick={closePreview}>回到最新</button></div><label>回放日期 <output>{date}</output><input aria-label="回放日期" aria-valuetext={date||"尚無日期"} type="range" min={0} max={Math.max(0,dates.length-1)} value={index} disabled={!dates.length} onChange={e=>move(Number(e.target.value))}/></label><small>日期採美東交易日；歷史播放僅使用已完成期間。</small></div>
   </div>
   <aside className="rotation-reader" aria-label="輪動解讀"><div className="rotation-reader-heading"><h2>{chosen?.symbol||'選擇標的'} <span>{chosen?.name}</span></h2><label className="rotation-symbol-picker">指定標的<select aria-label="指定標的" value={selected} onChange={e=>setSelected(e.target.value)}>{["sector","theme"].map(kind=><optgroup key={kind} label={kind==="sector"?"大板塊 ETF":"主題 ETF"}>{ROTATION_UNIVERSE.filter(r=>r.kind===kind&&symbols.includes(r.symbol)).map(r=><option key={r.symbol} value={r.symbol}>{r.symbol} · {r.name}</option>)}</optgroup>)}</select></label><label className="rotation-check"><input type="checkbox" checked={isolated} onChange={e=>setIsolated(e.target.checked)}/>只看此標的</label></div>
    {!point?<p className="rotation-muted">此日期沒有可排名的完整資料。可選擇其他標的，或回放較早日期。</p>:<><div className="rotation-state" style={{color:colors[point.quadrant]}}>{QUADRANTS[point.quadrant as keyof typeof QUADRANTS]}<small>{point.complete?'已完成期間':'未完成 · 暫時'}</small></div><dl className="rotation-values"><div><dt>相對強弱</dt><dd>{n(point.x)}</dd></div><div><dt>相對動能</dt><dd>{n(point.y)}</dd></div><div><dt>近一月報酬</dt><dd>{pct(point.returnMonth)}</dd></div><div><dt>相對 {settings.benchmark}</dt><dd>{pct(point.relativeMonth)}</dd></div></dl>
    <div className="rotation-readings">{readings.map((r:any,i:number)=><details key={i}><summary>{r.text}</summary><p>{r.evidence}</p></details>)}</div><p className="rotation-other">{settings.interval==='weekly'?'日線':'週線'}對照：{other?.x!=null?`${QUADRANTS[other.quadrant as keyof typeof QUADRANTS]} · ${other.date} 已完成`:'資料不足'}{other?.x!=null&&other.quadrant!==point.quadrant?'。兩個週期的狀態不同，請分開閱讀。':''}</p>
    <details className="rotation-transitions"><summary>最近象限變化</summary><ol>{rotationTransitions(chosen[settings.interval],date,{preview:latest&&settings.preview}).map((event:any)=><li key={event.date}><b>{event.date}{event.complete?"":" · 暫時"}</b><span>{event.from} → {event.to}</span><small>{event.evidence}</small></li>)}</ol></details>
    <ComparisonChart series={priceComparison(chosen.daily.filter((p:any)=>p.complete||(latest&&settings.preview)),date)} benchmark={settings.benchmark} symbol={selected}/></>}
   </aside></div>
   <div className="rotation-ranking"><div className="rotation-table-heading"><h2>輪動排名</h2><span>{visibleRows.filter((r:any)=>r.point).length} / {symbols.length} 個標的可比較 · 點選標的查看依據</span></div><div className="table-wrap"><table><thead><tr>{[['symbol','標的'],['quadrant','象限'],['x','相對強弱'],['y','相對動能'],['momentumChange','動能變化'],['speed','移動速度'],['returnMonth','近一月報酬'],['relativeMonth',`相對 ${settings.benchmark}`]].map(([key,label])=><th key={key} aria-sort={sort.key===key?(sort.descending?'descending':'ascending'):'none'}><button onClick={()=>setSort({key,descending:sort.key===key?!sort.descending:!['symbol','quadrant'].includes(key)})}>{label}{sort.key===key?(sort.descending?' ↓':' ↑'):''}</button></th>)}</tr></thead><tbody>{table.map((r:any)=><tr key={r.symbol} className={selected===r.symbol?'is-selected':''}><td><button className="rotation-symbol" aria-pressed={selected===r.symbol} onClick={()=>setSelected(r.symbol)}><strong>{r.symbol}</strong><span>{r.name}</span></button></td><td style={{color:colors[r.point?.quadrant]}}>{r.point?QUADRANTS[r.point.quadrant as keyof typeof QUADRANTS]:r.stale?'資料過期':'資料不足'}{r.point&&!r.point.complete&&<small className="block">暫時</small>}</td>{['x','y','momentumChange','speed'].map(k=><td key={k}>{n(r.point?.[k])}</td>)}<td>{pct(r.point?.returnMonth)}</td><td>{pct(r.point?.relativeMonth)}</td></tr>)}</tbody></table>{!table.length&&<p className="rotation-muted">此篩選沒有標的，請切回「全部」。</p>}</div></div>
  </>}
  <p className="rotation-source">來源：{data?.source||'Yahoo Finance via MarketDataAdapter'} · 每 60 秒檢查盤中更新 · RRG 概念延伸（tg-rotation-v1）</p>
 </section>;
}
function RotationPlot({rows,selected,onSelect,radius,date}:{rows:any[];selected:string;onSelect:(s:string)=>void;radius:number;date:string}) {
 const id=useId().replace(/:/g,''),left=58,top=34,size=490,x=(v:number)=>left+size/2+(v-100)*size/(2*radius),y=(v:number)=>top+size/2-(v-100)*size/(2*radius);
 const valid=rows.filter(r=>r.point);const labels:{x:number;y:number}[]=[];
 return <svg className="rotation-plot" viewBox="0 0 610 570" role="group" aria-label={`板塊輪動圖 ${date}，可用 Tab 選取標的`}>
  <defs><clipPath id={`${id}clip`}><rect x={left} y={top} width={size} height={size}/></clipPath>{Object.entries(colors).map(([key,color])=><marker key={key} id={`${id}${key}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill={color}/></marker>)}</defs>
  {[['改善','#edf4fa',left,top],['領先','#eaf4ee',left+size/2,top],['落後','#fbefed',left,top+size/2],['轉弱','#faf5e7',left+size/2,top+size/2]].map(([label,fill,rx,ry])=><g key={String(label)}><rect x={Number(rx)} y={Number(ry)} width={size/2} height={size/2} fill={String(fill)}/><text x={Number(rx)+14} y={Number(ry)+24} className="rotation-quadrant-label">{label}</text></g>)}
  {[-1,-.5,0,.5,1].map(t=><g key={t}><line x1={x(100+t*radius)} x2={x(100+t*radius)} y1={top} y2={top+size} stroke={t===0?'#82928a':'#d8e0db'} strokeDasharray={t===0?undefined:'3 5'}/><line x1={left} x2={left+size} y1={y(100+t*radius)} y2={y(100+t*radius)} stroke={t===0?'#82928a':'#d8e0db'} strokeDasharray={t===0?undefined:'3 5'}/><text x={x(100+t*radius)} y={top+size+20} textAnchor="middle" className="rotation-tick">{(100+t*radius).toFixed(1)}</text><text x={left-8} y={y(100+t*radius)+4} textAnchor="end" className="rotation-tick">{(100+t*radius).toFixed(1)}</text></g>)}
  <text x="303" y="565" textAnchor="middle" className="rotation-axis">相對強弱趨勢 →</text><text x="13" y="280" textAnchor="middle" transform="rotate(-90 13 280)" className="rotation-axis">相對動能 →</text>
  <g clipPath={`url(#${id}clip)`}>{rows.map(r=>{const tail=r.tail,c=colors[r.point?.quadrant||'boundary'];return <g key={r.symbol} opacity={selected===r.symbol?1:.65}>{tail.slice(1).map((p:any,i:number)=>tail[i].x==null||p.x==null?null:<path key={p.date} d={`M${x(tail[i].x)},${y(tail[i].y)} L${x(p.x)},${y(p.y)}`} fill="none" stroke={c} strokeWidth={selected===r.symbol?2.8:1.7} opacity={.25+.75*(i+1)/tail.length} strokeDasharray={!p.complete?'5 4':undefined} markerEnd={i===tail.length-2?`url(#${id}${r.point?.quadrant||'boundary'})`:undefined}/>)}</g>;})}</g>
  {valid.sort((a,b)=>Number(b.symbol===selected)-Number(a.symbol===selected)).map(r=>{const p=r.point,px=x(p.x),py=y(p.y);if(px<left||px>left+size||py<top||py>top+size)return null;let ly=py-12;const lx=Math.min(left+size-35,Math.max(left+25,px));let attempts=0;while(labels.some(l=>Math.abs(l.x-lx)<47&&Math.abs(l.y-ly)<15)&&attempts++<12)ly+=15;ly=Math.min(top+size-5,Math.max(top+15,ly));labels.push({x:lx,y:ly});const c=colors[p.quadrant];return <g key={r.symbol} role="button" tabIndex={0} aria-label={`${r.symbol} ${r.name}，${QUADRANTS[p.quadrant as keyof typeof QUADRANTS]}，強弱 ${n(p.x)}，動能 ${n(p.y)}`} aria-pressed={r.symbol===selected} onClick={()=>onSelect(r.symbol)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(r.symbol);}}} className="rotation-dot"><title>{r.name} {r.symbol} · {p.date} · 強弱 {n(p.x)} / 動能 {n(p.y)}</title><circle cx={px} cy={py} r="22" fill="transparent"/>{r.kind==='theme'?<path d={`M${px} ${py-6}l6 6-6 6-6-6Z`} fill={p.complete?c:'#fff'} stroke={c} strokeWidth="2"/>:<circle cx={px} cy={py} r={r.symbol===selected?6:4.5} fill={p.complete?c:'#fff'} stroke={c} strokeWidth="2"/>}<line x1={px} y1={py-6} x2={lx} y2={ly+3} stroke={c} opacity=".35"/><text x={lx} y={ly} textAnchor="middle" fill={c} className={r.symbol===selected?'is-selected':''}>{r.symbol}</text></g>;})}
  {!valid.length&&<text x="303" y="290" textAnchor="middle" className="rotation-axis">此日期或篩選沒有有效座標</text>}
 </svg>;
}
function ComparisonChart({series,benchmark,symbol}:{series:any[];benchmark:string;symbol:string}) {
 if(series.length<2)return null;const values=series.flatMap(p=>[p.asset,p.benchmark]).filter(v=>v!=null),low=Math.min(...values)-1,high=Math.max(...values)+1;
 const x=(i:number)=>10+i*280/Math.max(1,series.length-1),y=(v:number)=>110-(v-low)*90/(high-low),points=series.map((p,i)=>({...p,i}));
 return <div className="rotation-comparison"><h3>同日起點 100</h3><p><span>{symbol}</span> ／ <span>{benchmark}（虛線）</span></p><svg viewBox="0 0 310 130" role="img" aria-label={`${symbol} 與 ${benchmark} 的調整後價格比較，起點 ${series[0].date}`}><line x1="10" x2="290" y1={y(100)} y2={y(100)} stroke="#d8e0db"/><path d={pathFor(points,x,y,'asset','i')} fill="none" stroke="#176b50" strokeWidth="2"/><path d={pathFor(points,x,y,'benchmark','i')} fill="none" stroke="#53645c" strokeWidth="1.5" strokeDasharray="5 4"/><text x="10" y="125">{series[0].date}</text><text x="290" y="125" textAnchor="end">{series.at(-1).date}</text></svg><p>目前 {n(series.at(-1).asset)} ／ {n(series.at(-1).benchmark)}</p></div>;
}
