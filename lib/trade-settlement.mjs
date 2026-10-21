// Decimal rational arithmetic: never round the exchange rate or intermediate amounts.
const rational = value => {
 const text=String(value ?? '').trim();
 if(!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)||!Number.isFinite(Number(text)))throw Error('金額或匯率無效');
 const [mantissa,exponent='0']=text.toLowerCase().split('e'),[whole,fraction='']=mantissa.split('.');
 const scale=fraction.length-Number(exponent);
 if(Math.abs(scale)>100)throw Error('數值精度超出範圍');
 return scale>=0?[BigInt(whole+fraction),10n**BigInt(scale)]:[BigInt(whole+fraction)*10n**BigInt(-scale),1n];
};
const add=([a,b],[c,d])=>[a*d+c*b,b*d];
const mul=([a,b],[c,d])=>[a*c,b*d];
const div=([a,b],[c,d])=>{if(c===0n)throw Error('匯率必須大於零');return [a*d,b*c];};
const numeric=([a,b])=>Number(a)/Number(b);
const rounded=([a,b],currency)=>{
 const scale=currency==='TWD'?1n:100n,sign=a<0n?-1n:1n,n=a*sign*scale;
 const result=Number(sign*((n*2n+b)/(b*2n)))/Number(scale);
 if(!Number.isSafeInteger(Math.round(result*Number(scale))))throw Error('交割金額超出安全範圍');
 return result;
};
const currencies=['USD','TWD'];
export function buildSettlement(fill,input) {
 if(!input)return null;
 const currency=input.currency,feeCurrency=input.feeCurrency||fill.currency,mode=input.mode||'AUTO';
 if(!currencies.includes(currency)||!currencies.includes(feeCurrency)||!currencies.includes(fill.currency))throw Error('交割幣別無效');
 if(!['AUTO','RATE','TOTAL'].includes(mode))throw Error('交割模式無效');
 const gross=mul(rational(fill.quantity),rational(fill.price)),fee=rational(input.feeAmount??fill.fee??0);
 const cross=currency!==fill.currency||feeCurrency!==fill.currency;
 let rate=cross&&!(mode==='TOTAL'&&currency!==fill.currency)?rational(input.rate):[1n,1n];
 if(mode==='TOTAL'&&currency!==fill.currency){
  const total=rational(input.total),signedFee=fill.side==='BUY'?fee:[-fee[0],fee[1]];
  // total = converted principal +/- fee. Fees may be in either native currency.
  const native=feeCurrency===fill.currency?add(gross,signedFee):gross;
  const target=feeCurrency===currency?add(total,[-signedFee[0],signedFee[1]]):total;
  if(native[0]<=0n||target[0]<=0n)throw Error('交割總額不足以涵蓋費用');
  rate=fill.currency==='USD'?div(target,native):div(native,target);
 }
 if(rate[0]<=0n)throw Error('請提供有效匯率');
 if(cross&&mode==='AUTO'&&(!input.rateDate||!input.source))throw Error('缺少匯率來源，請重試或手動輸入');
 const convert=(amount,from,to)=>from===to?amount:from==='USD'?mul(amount,rate):div(amount,rate);
 const nativeFee=convert(fee,feeCurrency,fill.currency),convertedFee=convert(fee,feeCurrency,currency);
 const expected=add(convert(gross,fill.currency,currency),fill.side==='BUY'?convertedFee:[-convertedFee[0],convertedFee[1]]);
 const total=mode==='TOTAL'?rounded(rational(input.total),currency):rounded(expected,currency);
 if(total<0)throw Error('費用超過賣出交割金額');
 return {version:1,fillId:fill.id,currency,total,mode,rate:cross?numeric(rate):1,rateDate:input.rateDate||null,forDate:input.forDate||null,source:mode==='AUTO'?(cross?input.source:'同幣別'): '使用者輸入',feeCurrency,feeAmount:numeric(fee),nativeFee:numeric(nativeFee),includesFee:true};
}
export function fillCashFlow(fill){
 if(fill.settlement){
  const s=fill.settlement;
  if(s.version!==1||s.fillId!==fill.id||!currencies.includes(s.currency)||!Number.isFinite(s.total)||s.total<0)throw Error('成交交割資料無效');
  return {currency:s.currency,amount:(fill.side==='BUY'?-1:1)*s.total};
 }
 return {currency:fill.currency||'USD',amount:(fill.side==='BUY'?-1:1)*Number(fill.quantity)*Number(fill.price)-Number(fill.fee||0)};
}
