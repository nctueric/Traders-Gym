// NYSE regular sessions. Source: https://www.nyse.com/trade/hours-calendars
// Calendar support is deliberately bounded; extend/review before using later years.
export const CALENDAR_VERSION = 'nyse-2023-2028-v1';
export const shiftDay = (date, n) => new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const dow = date => new Date(date+'T12:00:00Z').getUTCDay();
const fmt = (y,m,d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const nth = (y,m,w,n) => shiftDay(fmt(y,m,1),(w-dow(fmt(y,m,1))+7)%7+7*(n-1));
const observed = date => shiftDay(date,dow(date)===6?-1:dow(date)===0?1:0);
const years = new Map();
function holidays(y) {
 if(years.has(y))return years.get(y);
 const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),v=h+l-7*m+114;
 const easter=fmt(y,Math.floor(v/31),v%31+1);
 const memorial=shiftDay(fmt(y,5,31),-(dow(fmt(y,5,31))+6)%7);
 const set=new Set([nth(y,1,1,3),nth(y,2,1,3),shiftDay(easter,-2),memorial,observed(fmt(y,6,19)),observed(fmt(y,7,4)),nth(y,9,1,1),nth(y,11,4,4),observed(fmt(y,12,25))]);
 if(dow(fmt(y,1,1))!==6)set.add(observed(fmt(y,1,1)));
 if(y===2025)set.add('2025-01-09'); // National day of mourning for President Carter.
 years.set(y,set);return set;
}
export function tradingDay(date) {
 const y=Number(date.slice(0,4));
 if(y<2023||y>2028)throw Error('交易日曆僅支援 2023–2028，請更新日曆');
 return ![0,6].includes(dow(date))&&!holidays(y).has(date);
}
const easternFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function easternTime(now=Date.now()) {
 const parts=Object.fromEntries(easternFormatter.formatToParts(new Date(now)).map(p=>[p.type,p.value]));
 return {date:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute)};
}
export function sessionClose(date) {
 const y=Number(date.slice(0,4));
 return date===shiftDay(nth(y,11,4,4),1)||date===fmt(y,7,3)||date===fmt(y,12,24)?780:960;
}
export function sessionState(now=Date.now()) {
 const {date,minute}=easternTime(now),openDay=tradingDay(date),close=sessionClose(date);
 let completed=date;
 if(!openDay||minute<close) {do{completed=shiftDay(completed,-1);}while(!tradingDay(completed));}
 return {date,minute,open:openDay&&minute>=570&&minute<close,lastCompleted:completed};
}
export function sessionDates(start,end) {
 const out=[];for(let date=start;date<=end;date=shiftDay(date,1))if(tradingDay(date))out.push(date);return out;
}
export const weekKey = date => shiftDay(date,-((dow(date)+6)%7));
export function weekEnd(date) {
 const monday=weekKey(date);let end=shiftDay(monday,4);while(!tradingDay(end))end=shiftDay(end,-1);return end;
}
