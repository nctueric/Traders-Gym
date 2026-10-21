import {writeLedgerRecordCache as writeDirect,clearLedgerRecordCache as clearDirect} from './ledger-record-cache.mjs';
import {cacheDatasetPatch} from './ledger-cache-transfer.mjs';

export function createBackgroundLedgerCache({createWorker,fallback=writeDirect,timeoutMs=30000}) {
 let worker=null,disabled=false,previous=null,previousOptions=null,previousKey=null,tail=Promise.resolve();
 const write=async options=>{
  if(disabled)return fallback(options);
  try {
   worker ||= createWorker();
   const key=JSON.stringify([options.userId,options.record.account.id]);
   const dataset=options.record.dataset;
   const patch=cacheDatasetPatch(key===previousKey?previous:null,dataset);
   const metadata={...options,record:{...options.record,dataset:undefined}};
   // The saved cloud baseline can itself include the entire history snapshot.
   const optionsPatch=cacheDatasetPatch(key===previousKey?previousOptions:null,metadata);
   const result=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Cache worker timeout')),timeoutMs);
    const finish=fn=>value=>{clearTimeout(timer);fn(value);};
    worker.onmessage=finish(event=>resolve(event.data?.ok===true));
    worker.onerror=finish(reject);worker.onmessageerror=finish(reject);
    try {worker.postMessage({key,patch,optionsPatch});}
    catch(error){clearTimeout(timer);reject(error);}
   });
   // A failed transaction must retry with a complete checkpoint.
   previous=result?dataset:null;previousOptions=result?metadata:null;previousKey=result?key:null;
   return result;
  } catch {
   worker?.terminate();worker=null;previous=null;previousOptions=null;disabled=true;
   return fallback(options);
  }
 };
 return {
  write(options){const task=tail.then(()=>write(options));tail=task.catch(()=>{});return task;},
  clear(userId,accountId){const task=tail.then(()=>clearDirect(userId,accountId));tail=task.catch(()=>{});return task;},
 };
}

const cache=createBackgroundLedgerCache({createWorker:()=>new Worker(new URL('./ledger-cache-worker.mjs',import.meta.url),{type:'module'})});
export const writeLedgerRecordCache=options=>cache.write(options);
export const clearLedgerRecordCache=(userId,accountId='')=>cache.clear(userId,accountId);
