import {buildCycles} from './trade-engine.mjs';

export function saveTradingAccount(data,input){
 const existing=data.accounts.find(a=>a.id===input.id);
 const name=String(input.name||'').trim();
 if(!name||name.length>80)throw Error('帳戶名稱需為 1–80 個字');
 if(!['USD','TWD'].includes(input.currency))throw Error('請選擇交割幣別');
 if(input.disabled&&buildCycles(data).positions.some(p=>p.accountId===input.id&&Math.abs(p.quantity)>1e-9))throw Error('帳戶仍有持倉，不能停用');
 const account={...existing,id:input.id||crypto.randomUUID(),name,currency:input.currency,multiCurrency:true,disabled:!!input.disabled};
 const accounts=existing?data.accounts.map(a=>a.id===account.id?account:a):[...data.accounts,account];
 return {...data,accounts};
}

export function selectTradingAccount(data,symbol,currency,explicitId=''){
 const active=(data.accounts||[]).filter(a=>!a.disabled);
 if(explicitId)return active.find(a=>a.id===explicitId)||null;
 if(!symbol||!currency)return null;
 // Account selection needs open quantities, not historical MAE/MFE. Scanning
 // every price bar for every closed cycle made ticker entry block on mobile.
 const positions=buildCycles({fills:data.fills,marketBars:[]}).positions.filter(p=>p.symbol===symbol&&p.currency===currency);
 const held=active.filter(a=>positions.some(p=>p.accountId===a.id));
 if(held.length)return held.length===1?held[0]:null;
 const preferred=active.find(a=>a.id===data.settings?.entryAccounts?.[currency]);
 if(preferred)return preferred;
 const native=active.filter(a=>a.currency===currency);
 if(native.length===1)return native[0];
 if(native.length>1)return null;
 return active.length===1?active[0]:null;
}
