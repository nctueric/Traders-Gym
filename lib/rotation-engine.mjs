import {sessionDates,weekKey,weekEnd} from './rotation-calendar.mjs';
export const ROTATION_VERSION='tg-rotation-v1';
export const ROTATION_UNIVERSE=[
 ['XLB','原物料','sector'],['XLC','通訊服務','sector'],['XLE','能源','sector'],['XLF','金融','sector'],['XLI','工業','sector'],['XLK','科技','sector'],['XLP','必需消費','sector'],['XLRE','不動產','sector'],['XLU','公用事業','sector'],['XLV','醫療保健','sector'],['XLY','非必需消費','sector'],
 ['SMH','半導體','theme'],['AIQ','人工智慧','theme'],['BOTZ','機器人','theme'],['CIBR','資安','theme'],['SKYY','雲端運算','theme'],['FINX','金融科技','theme'],['ICLN','潔淨能源','theme'],['TAN','太陽能','theme'],['GRID','智慧電網','theme'],['PAVE','基礎建設','theme'],['ARKK','創新科技','theme'],['ARKG','基因科技','theme'],
].map(([symbol,name,kind])=>({symbol,name,kind}));
export const SECTOR_SYMBOLS=ROTATION_UNIVERSE.filter(r=>r.kind==='sector').map(r=>r.symbol);
export const BENCHMARKS=['SPY','QQQ','SHV'];
export const DEFAULT_ROTATION={benchmark:'SPY',interval:'weekly',themes:[],tail:12,preview:true};
export function validRotationSettings(v) {
 return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===5&&BENCHMARKS.includes(v.benchmark)&&['daily','weekly'].includes(v.interval)&&[6,12,24].includes(v.tail)&&typeof v.preview==='boolean'&&Array.isArray(v.themes)&&v.themes.length<=12&&new Set(v.themes).size===v.themes.length&&v.themes.every(s=>ROTATION_UNIVERSE.some(r=>r.symbol===s&&r.kind==='theme'));
}
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
export function quadrant(x,y) {
 if(Math.abs(x-100)<1e-10||Math.abs(y-100)<1e-10)return 'boundary';
 return x>100?(y>100?'leading':'weakening'):(y>100?'improving':'lagging');
}
export const QUADRANTS={leading:'領先',weakening:'轉弱',lagging:'落後',improving:'改善',boundary:'臨界'};
export function weightedMean(values,n) {
 if(values.length<n)return null;
 return values.slice(-n).reduce((sum,v,i)=>sum+v*(i+1),0)/(n*(n+1)/2);
}
// Calendar alignment preserves missing sessions. A gap resets the entire warm-up.
export function alignPeriods(asset,benchmark,{start,end,interval='daily',completedThrough=end}) {
 const a=new Map(asset.map(b=>[b.date,b.close])),b=new Map(benchmark.map(b=>[b.date,b.close]));
 const days=sessionDates(start,end).map(date=>({date,close:a.get(date)??null,benchmark:b.get(date)??null,complete:date<=completedThrough}));
 if(interval==='daily')return days;
 const groups=new Map();for(const day of days){const key=weekKey(day.date);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(day);}
 return [...groups.values()].map(group=>{
  const last=group.at(-1),valid=group.every(d=>positive(d.close)&&positive(d.benchmark));
  return {...last,close:valid?last.close:null,benchmark:valid?last.benchmark:null,complete:last.complete&&last.date===weekEnd(last.date)};
 });
}
export function rotationSeries(periods) {
 let ratios=[],xs=[],previous=null;
 return periods.map((p,index)=>{
  const base={...p,x:null,y:null,quadrant:null,speed:null,heading:null,momentumChange:null,returnMonth:null,relativeMonth:null};
  if(!positive(p.close)||!positive(p.benchmark)){ratios=[];xs=[];previous=null;return base;}
  ratios.push(p.close/p.benchmark);
  const x=ratios.length>=30?100*weightedMean(ratios,10)/weightedMean(ratios,30):null;
  xs.push(x);const lag=xs.at(-4);
  if(x==null||lag==null)return base;
  const y=100*x/lag,dx=previous?x-previous.x:0,dy=previous?y-previous.y:0;
  const point={...base,x,y,quadrant:quadrant(x,y),speed:previous?Math.hypot(dx,dy):null,heading:previous&&Math.hypot(dx,dy)>1e-10?(Math.atan2(dy,dx)*180/Math.PI+360)%360:null,momentumChange:previous?dy:null};
  // Calendar-month comparison, never a future endpoint or a compressed gap.
  const date=new Date(p.date+'T12:00:00Z'),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-1);const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));
  const cutoff=date.toISOString().slice(0,10);let old=index-1;while(old>=0&&periods[old].date>cutoff)old--;
  if(old>=0&&periods.slice(old,index+1).every(d=>positive(d.close)&&positive(d.benchmark))){point.returnMonth=p.close/periods[old].close-1;point.relativeMonth=(p.close/p.benchmark)/(periods[old].close/periods[old].benchmark)-1;}
  previous=point;return point;
 });
}
export function rotationReadings(series,asOf,{preview=false}={}) {
 const eligible=series.filter(p=>p.date<=asOf&&(preview||p.complete));const last=eligible.at(-1);
 if(last?.x==null)return [];
 const prior=eligible.at(-2),label=last.complete?'':'暫時：',out=[];
 const evidence=points=>points.map(p=>`${p.date}：強弱 ${p.x?.toFixed(2)??'—'}，動能 ${p.y?.toFixed(2)??'—'}`).join('；');
 if(prior?.x!=null&&last.quadrant!==prior.quadrant)out.push({text:`${label}從${QUADRANTS[prior.quadrant]}進入${QUADRANTS[last.quadrant]}`,evidence:evidence([prior,last])});
 const four=eligible.slice(-4);
 if(four.length===4&&four.every(p=>p.x!=null)&&four.slice(1).every((p,i)=>p.y<four[i].y))out.push({text:`${label}${last.x>100?'相對強弱仍高於中線，':'相對強弱未站上中線，'}但動能連續三期下降`,evidence:evidence(four)});
 if(last.returnMonth<0&&last.relativeMonth>0)out.push({text:`${label}近一月相對轉強，但價格仍下跌`,evidence:`調整後報酬 ${(last.returnMonth*100).toFixed(2)}%；相對基準 ${(last.relativeMonth*100).toFixed(2)}%`});
 out.push({text:`${label}目前位於${QUADRANTS[last.quadrant]}${last.heading==null?'，尚無明確移動方向':`，移動方向 ${last.heading.toFixed(0)}°`}`,evidence:evidence([last])});
 return out;
}
// Completed weekly points only: a daily replay on Wednesday cannot see Friday.
export function periodAt(series,date,{preview=false}={}) {return series.filter(p=>p.date<=date&&(preview||p.complete)).at(-1)??null;}
export function priceComparison(series,date,limit=126) {
 const rows=series.filter(p=>p.date<=date).slice(-limit),first=rows.find(p=>positive(p.close)&&positive(p.benchmark));
 if(!first)return [];
 return rows.filter(p=>p.date>=first.date).map(p=>({date:p.date,asset:positive(p.close)?100*p.close/first.close:null,benchmark:positive(p.benchmark)?100*p.benchmark/first.benchmark:null}));
}
export function rotationTransitions(series,asOf,{preview=false,limit=6}={}) {
 let previous=null;const events=[];
 for(const point of series){
  if(point.date>asOf||(!preview&&!point.complete))continue;
  if(point.x==null){previous=null;continue;}
  if(previous&&previous.quadrant!==point.quadrant)events.push({date:point.date,from:QUADRANTS[previous.quadrant],to:QUADRANTS[point.quadrant],complete:point.complete,evidence:`${previous.date} (${previous.x.toFixed(2)}, ${previous.y.toFixed(2)}) → ${point.date} (${point.x.toFixed(2)}, ${point.y.toFixed(2)})`});
  previous=point;
 }
 return events.slice(-limit).reverse();
}
