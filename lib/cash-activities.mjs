export const CASH_TYPES={DEPOSIT:'入金',WITHDRAWAL:'出金',DIVIDEND:'股息',INTEREST:'利息',FEE:'費用',TAX:'稅款',OPENING_BALANCE:'期初餘額校正'};
export const cashDelta=row=>['WITHDRAWAL','FEE','TAX'].includes(row.type)?-row.amount:row.amount;
export function validCashAmount(amount,type){return amount!=null&&String(amount).trim()!==''&&Number.isFinite(Number(amount))&&(type==='OPENING_BALANCE'||Number(amount)>0);}
export function validateCashActivity(input,accounts){
 if(!Object.hasOwn(CASH_TYPES,input.type))throw new Error('請選擇資金類型');
 if(!accounts.some(account=>account.id===input.accountId))throw new Error('請選擇交易帳戶');
 if(!['USD','TWD'].includes(input.currency))throw new Error('請選擇 USD 或 TWD');
 if(!validCashAmount(input.amount,input.type))throw new Error('金額必須為大於零的數字；餘額校正可為零或負數');
 if(!input.timestamp||!Number.isFinite(Date.parse(input.timestamp)))throw new Error('請填寫有效的發生時間');
 if(String(input.note||'').length>2000)throw new Error('備註最多 2,000 字');
 return {id:input.id||crypto.randomUUID(),type:input.type,amount:Number(input.amount),accountId:input.accountId,currency:input.currency,timestamp:new Date(input.timestamp).toISOString(),note:String(input.note||'').trim(),source:input.source||'手動登錄',requiresReview:false};
}
export function updateCashActivity(dataset,input){const row=validateCashActivity(input,dataset.accounts);const rows=dataset.cashActivities||[];return {...dataset,cashActivities:rows.some(item=>item.id===row.id)?rows.map(item=>item.id===row.id?{...item,...row}:item):[...rows,row]};}
