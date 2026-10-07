import {recordDay} from './performance-history.mjs';
export function convertCurrency(amount,from,to,rate){
 if(typeof amount!=='number'||!Number.isFinite(amount)||!['USD','TWD'].includes(from)||!['USD','TWD'].includes(to))return null;
 if(from===to)return amount;
 if(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0)return null;
 return from==='USD'?amount*rate:amount/rate;
}
export function currencyTotal(values,to,rate){let total=0;for(const [currency,value]of Object.entries(values)){const converted=value===0&&['USD','TWD'].includes(currency)?0:convertCurrency(value,currency,to,rate);if(converted==null)return null;total+=converted;}return total;}
export function historicalFx(bars,date){const row=(bars||[]).filter(b=>b.date<=date&&typeof b.close==='number'&&b.close>0).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);return row&&Date.parse(date)-Date.parse(row.date)<=7*86400000?row.close:null;}
export function cycleValue(cycle,amount,to,bars){const date=cycle.fills?.at(-1)?.tradeDate||recordDay({timestamp:cycle.closeAt});return convertCurrency(amount,cycle.currency||'USD',to,historicalFx(bars,date));}
export function formatCurrency(amount,currency='USD'){return amount==null||!Number.isFinite(amount)?'—':new Intl.NumberFormat('zh-TW',{style:'currency',currency,currencyDisplay:'code',maximumFractionDigits:2}).format(amount);}
