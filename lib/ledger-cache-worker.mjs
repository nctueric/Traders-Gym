import {writeLedgerRecordCache} from './ledger-record-cache.mjs';
import {applyCacheDatasetPatch} from './ledger-cache-transfer.mjs';
let dataset=null,options=null,key=null;
globalThis.onmessage=async({data:message})=>{
 try {
  if(message.key!==key){dataset=null;options=null;key=message.key;}
  dataset=applyCacheDatasetPatch(dataset,message.patch);
  options=applyCacheDatasetPatch(options,message.optionsPatch);
  const ok=await writeLedgerRecordCache({...options,record:{...options.record,dataset}});
  globalThis.postMessage({ok});
 } catch {globalThis.postMessage({ok:false});}
};
