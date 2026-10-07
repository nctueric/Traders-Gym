import {convertCurrency,currencyTotal} from './valuation.mjs';
import { toProviderSymbol } from './quote-engine.mjs';
import { isVerifiedClosureQuote } from './performance-market-closures.mjs';
import { DAY, recordDay, priorDay, validDay } from './performance-history.mjs';
const valid = v => typeof v==='number'&&Number.isFinite(v);
const dayValid = validDay;
const signs={DEPOSIT:1,WITHDRAWAL:-1,DIVIDEND:1,INTEREST:1,FEE:-1,TAX:-1};
export function dailyDietz(before,after,flows){
 if(!valid(before)||!valid(after)||before<=0||after<=0)return null;
 const net=flows.reduce((s,f)=>s+f.amount,0),denominator=before+flows.reduce((s,f)=>s+f.amount*f.weight,0);
 if(!(denominator>0))return null;
 const rate=(after-before-net)/denominator;return Number.isFinite(rate)&&rate>-1?rate:null;
}
function latest(bars,date){let left=0,right=bars.length-1,result=null;while(left<=right){const i=(left+right)>>1;if(bars[i].date<=date){result=bars[i];left=i+1;}else right=i-1;}return result;}
export function buildPerformanceDaily(data,cache,now=new Date(),currency="USD"){
 const index=new Map(Object.entries(cache?.entries||{}).map(([k,v])=>[k,(v.bars||[]).filter(b=>dayValid(b.date)&&valid(b.close)&&b.close>0).sort((a,b)=>a.date.localeCompare(b.date))]));
 let end=priorDay(now.toISOString().slice(0,10));
 for(const symbol of ['QQQ','SPY']){const last=latest(index.get(symbol+':adjusted')||[],end);if(last && last.date<end)end=last.date;}
 const records=[...(data.fills||[]).map(row=>({kind:'fill',row})),...(data.cashActivities||[]).map(row=>({kind:'cash',row}))];
 const invalidDates=records.some(({row})=>!dayValid(recordDay(row)));
 const events=records.filter(e=>dayValid(recordDay(e.row))&&recordDay(e.row)<=end).sort((a,b)=>Date.parse(a.row.timestamp||recordDay(a.row))-Date.parse(b.row.timestamp||recordDay(b.row)) || Number(b.row.type==='OPENING_BALANCE')-Number(a.row.type==='OPENING_BALANCE'));
 if(!events.length)return {points:[],start:null,end,problems:invalidDates?['帳本有無效日期']:[]};
 const start=events.map(e=>recordDay(e.row)).sort()[0],byDate=new Map();
 for(const event of events){const date=recordDay(event.row);if(!byDate.has(date))byDate.set(date,[]);byDate.get(date).push(event);}
 let cashByCurrency={},funded=false,previous=null;const holdings=new Map(),cashProblems=new Set(),persistentWarnings=new Set(),positionProblems=new Set(),points=[];
 if(invalidDates)positionProblems.add('帳本有無效日期');
 const price=(symbol,basis,date,problems,quoteDates,warnings)=>{
  const bar=latest(index.get(symbol+':'+basis)||[],date);
  if(!bar){problems.add(`缺 ${symbol} ${basis==='adjusted'?'調整價':'收盤價'}`);return null;}
  if(Date.parse(date)-Date.parse(bar.date)>7*DAY){
   if(basis==='raw'&&isVerifiedClosureQuote(symbol,bar.date,date)){
    warnings?.add(`${symbol} 春節休市，沿用 ${bar.date} 收盤價；估值仍依當日可用匯率換算`);
   }else{problems.add(`${symbol} 行情逾七日（${bar.date}）`);return null;}
  }
  quoteDates[symbol]=bar.date;return bar.close;
 };
 for(let time=Date.parse(start);time<=Date.parse(end);time+=DAY){
  const date=new Date(time).toISOString().slice(0,10),problems=new Set(positionProblems),warnings=new Set(persistentWarnings),quoteDates={},flows=[];let reset=false;
  const base=(amount,sourceCurrency)=>{if(!valid(amount)){problems.add('帳務金額無效');return null;}if(!['USD','TWD'].includes(sourceCurrency)){problems.add('帳務幣別未確認');return null;}if(amount===0)return 0;const fx=sourceCurrency===currency?null:price('USDTWD=X','raw',date,problems,quoteDates);return convertCurrency(amount,sourceCurrency,currency,fx);};
  const cashChange=(amount,sourceCurrency)=>{if(!valid(amount)||!['USD','TWD'].includes(sourceCurrency)){cashProblems.add('帳務金額或幣別無效');return false;}cashByCurrency[sourceCurrency]=(cashByCurrency[sourceCurrency]||0)+amount;return true;};
  const todays=byDate.get(date)||[];
  const openings=todays.filter(e=>e.kind==='cash'&&e.row.type==='OPENING_BALANCE');
  if(openings.length>1)cashProblems.add('同日多筆期初餘額，需核對共用資金池');
  for(const {kind,row} of todays){
   if(kind==='cash'){
    if(row.type==='OPENING_BALANCE'){
     reset=previous!==null;cashProblems.clear();if(openings.length>1)cashProblems.add('同日多筆期初餘額，需核對共用資金池');
     cashByCurrency={};funded=cashChange(row.amount,row.currency);if(row.requiresReview)cashProblems.add('期初餘額待確認');continue;
    }
    if(row.requiresReview || signs[row.type]==null){cashProblems.add('資金活動待確認');continue;}
    if(!valid(row.amount)||row.amount<0){cashProblems.add('資金活動金額無效');continue;}
    if(!cashChange(signs[row.type]*row.amount,row.currency))continue;
    if(row.type==='DEPOSIT')funded=true;
    if(['DEPOSIT','WITHDRAWAL'].includes(row.type)){
     const explicit=row.datePrecision!=='date'&&row.datePrecision!=='DATE'&&String(row.timestamp).includes('T');
     const timestamp=Date.parse(row.timestamp),weight=explicit&&Number.isFinite(timestamp)?Math.max(0,Math.min(1,(time+DAY-timestamp)/DAY)):.5;
     const amount=base(signs[row.type]*row.amount,row.currency);if(amount!=null)flows.push({amount,weight});if(!explicit)warnings.add('日期精度入出金採日中權重');
    }
   }else{
    if(!valid(row.quantity)||row.quantity<=0||!valid(row.price)||row.price<=0||!['BUY','SELL'].includes(row.side)|| (row.fee!=null&&(!valid(row.fee)||row.fee<0))){positionProblems.add('成交資料無效');problems.add('成交資料無效');continue;}
    const symbol=toProviderSymbol(row.symbol,row.market||row.exchange),currency=row.currency,key=JSON.stringify([row.accountId||'',symbol,currency]);
    const holding=holdings.get(key)||{symbol,currency,quantity:0};holding.quantity+=(row.side==='BUY'?1:-1)*row.quantity;holdings.set(key,holding);
    cashChange((row.side==='BUY'?-1:1)*row.quantity*row.price-(row.fee||0),currency);
    if(row.feeKnown===false)persistentWarnings.add('未含未填手續費');
   }
  }
  for(const p of cashProblems)problems.add(p);for(const w of persistentWarnings)warnings.add(w);
  if(!funded)problems.add('缺期初資金資料');
  let positions=0;
  for(const h of holdings.values()){
   if(Math.abs(h.quantity)<1e-9)continue;
   const close=price(h.symbol,'raw',date,problems,quoteDates,warnings);
   if(close!=null){const value=base(h.quantity*close,h.currency);if(value!=null)positions+=value;}
  }
  let cash=0;
  for(const [sourceCurrency,balance] of Object.entries(cashByCurrency)){const value=base(balance,sourceCurrency);if(value!=null)cash+=value;}
  const equity=cash+positions;if(!(equity>0)||!Number.isFinite(equity))problems.add('淨值不大於零或無效');
  const total=problems.size?null:equity;const rate=reset?null:dailyDietz(previous?.total??null,total,flows);
  if(reset)warnings.add('期初餘額校正，績效中斷');
  if(previous&&total!=null&&previous.total!=null&&rate==null&&!reset)problems.add('加權資金分母無效');
  const benchmark={},benchmarkProblems={};
  for(const symbol of ['QQQ','SPY']){const issues=new Set();const close=price(symbol,'adjusted',date,issues,quoteDates);const fx=currency==='TWD'?price('USDTWD=X','raw',date,issues,quoteDates):null;benchmark[symbol]=convertCurrency(close,'USD',currency,fx);benchmarkProblems[symbol]=[...issues];}
  const priceForUsd=()=>{const bar=latest(index.get("USDTWD=X:raw")||[],date);return bar&&Date.parse(date)-Date.parse(bar.date)<=7*DAY?bar.close:null;};
  const point={date,total:problems.size?null:total,currency,cashValue:cash,positionsValue:positions,cashUsd:currencyTotal(cashByCurrency,"USD",priceForUsd()),positionsUsd:currency==="USD"?positions:convertCurrency(positions,"TWD","USD",priceForUsd()),flow:flows.reduce((s,f)=>s+f.amount,0),rate,reset,benchmark,problems:[...problems],benchmarkProblems,warnings:[...warnings],quoteDates};
  points.push(point);previous=point;
 }
 return {points,currency,start,end,problems:invalidDates?['帳本有無效日期']:[]};
}
export function performanceRange(daily,start,end){
 const rows=daily.points.filter(p=>p.date>=start&&p.date<=end);let product=1,peak=1;const benchmarkBase={},benchmarkPeak={QQQ:1,SPY:1},blocked={portfolio:false,QQQ:false,SPY:false};
 const points=rows.map((p,i)=>{
  let portfolio=null,drawdown=null;const issues=[...p.problems];
  if(i===0){blocked.portfolio=p.total==null;}else if(p.rate==null){blocked.portfolio=true;issues.push(p.reset?'期初餘額校正中斷':'日報酬缺資料');}
  if(!blocked.portfolio){if(i>0)product*=1+p.rate;portfolio=product-1;peak=Math.max(peak,product);drawdown=product/peak-1;}
  const returns={},drawdowns={};
  for(const symbol of ['QQQ','SPY']){
   const close=p.benchmark[symbol];if(i===0)benchmarkBase[symbol]=close;
   if(close==null||!benchmarkBase[symbol])blocked[symbol]=true;
   const index=blocked[symbol]?null:close/benchmarkBase[symbol];returns[symbol]=index==null?null:index-1;
   if(index!=null)benchmarkPeak[symbol]=Math.max(benchmarkPeak[symbol],index);
   drawdowns[symbol]=index==null?null:index/benchmarkPeak[symbol]-1;
  }
  return {...p,portfolio,drawdown,returns,drawdowns,issues};
 });
 const last=points.at(-1),validDd=points.map(p=>p.drawdown).filter(valid);
 const months=[];
 for(const month of [...new Set(rows.map(p=>p.date.slice(0,7)))]){
  const selected=rows.filter(p=>p.date.startsWith(month));const first=selected[0],last=selected.at(-1);const baseline=first.date===rows[0]?.date?null:daily.points.find(p=>p.date===priorDay(first.date));
  const monthlyRows=baseline?[baseline,...selected]:selected;const range=performanceRangeValues(monthlyRows);
  const monthEnd=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
  months.push({month,...range,partial:first.date!==month+'-01'||last.date!==monthEnd||!baseline});
 }
 return {points,months,summary:{portfolio:last?.portfolio??null,QQQ:last?.returns.QQQ??null,SPY:last?.returns.SPY??null,maxDrawdown:!blocked.portfolio&&validDd.length?Math.min(...validDd):null},start:rows[0]?.date||start,end:rows.at(-1)?.date||end};
}
function performanceRangeValues(rows){
 let result=1;const first=rows[0],last=rows.at(-1);let portfolio=first?.total==null?null:0;
 for(const p of rows.slice(1)){if(p.rate==null){portfolio=null;break;}result*=1+p.rate;portfolio=result-1;}
 const output={portfolio};for(const symbol of ['QQQ','SPY'])output[symbol]=rows.some(p=>p.benchmark[symbol]==null)||!first?.benchmark[symbol]?null:last.benchmark[symbol]/first.benchmark[symbol]-1;
 return output;
}
