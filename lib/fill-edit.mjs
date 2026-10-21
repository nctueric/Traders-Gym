import {reconcileBackdatedCycles} from './cycle-rebuild.mjs';
import {marketCurrency,marketDate} from './trade-entry.mjs';

const markets=['NASDAQ','NYSE','AMEX','TWSE','TPEX'];
const positive=value=>value!==''&&value!=null&&Number.isFinite(Number(value))&&Number(value)>0;

export function updateRecordedFill(dataset,original,draft,now=new Date().toISOString()) {
 const current=dataset.fills.find(fill=>fill.id===original.id);
 if(!current)throw Error('這筆成交已不存在，請重新開啟帳本');
 if(JSON.stringify(current)!==JSON.stringify(original))throw Error('這筆成交已更新，請重新開啟編輯視窗');
 const account=dataset.accounts.find(item=>item.id===draft.accountId);
 if(!account)throw Error('請選擇有效交易帳戶');
 if(!markets.includes(draft.market))throw Error('請選擇有效市場');
 const currency=marketCurrency(draft.market);
 if(account.currency!==currency)throw Error(`帳戶幣別 ${account.currency} 與市場 ${currency} 不符`);
 const symbol=String(draft.symbol||'').trim().toUpperCase();
 if(!/^[A-Z0-9.^=-]{1,20}$/.test(symbol))throw Error('請輸入有效標的代號');
 if(!['BUY','SELL'].includes(draft.side))throw Error('買賣方向無效');
 if(!positive(draft.quantity)||!positive(draft.price))throw Error('股數與成交價必須大於零');
 if(draft.fee===''||!Number.isFinite(Number(draft.fee))||Number(draft.fee)<0)throw Error('手續費必須為零或正數');
 const instant=Date.parse(draft.timestamp);
 if(!Number.isFinite(instant)||instant>Date.parse(now))throw Error('成交時間無效或尚未發生');
 const timestamp=instant===Date.parse(current.timestamp)?current.timestamp:new Date(instant).toISOString();
 const updated={...current,accountId:account.id,market:draft.market,currency,symbol,side:draft.side,quantity:Number(draft.quantity),price:Number(draft.price),fee:Number(draft.fee),timestamp,note:String(draft.note||'').trim()};
 if(current.tradeDate)updated.tradeDate=marketDate(timestamp,draft.market);
 if(timestamp!==current.timestamp||draft.market!==current.market)delete updated.timeSource;
 if(JSON.stringify(current)===JSON.stringify(updated))return dataset;
 const context=dataset.entryContexts?.[current.id];
 const next={...dataset,fills:dataset.fills.map(fill=>fill.id===current.id?updated:fill),
  ...(context?{entryContexts:{...dataset.entryContexts,[current.id]:{...context,fillEditedAt:now}}}:{}),
  fillEditHistory:[...(dataset.fillEditHistory||[]),{id:`fill-edit-${current.id}-${now}`,fillId:current.id,timestamp:now,before:current,after:updated}]};
 // Changes in order, direction, quantity or symbol can split and merge FIFO cycles.
 return reconcileBackdatedCycles(dataset,next,current.id,now);
}
