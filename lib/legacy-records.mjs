import {isDataset,durableTradeJson} from './trade-record-store.mjs';
export function legacyBrowserRecords(storage,userId){
 const prefix=`trade-review.phase0.v1.user.${userId}`;const rows=[];
 if(!storage)return rows;
 for(let i=0;i<storage.length;i++){const key=storage.key(i);if(!key?.startsWith(prefix+'.'))continue;
  try{const raw=JSON.parse(storage.getItem(key));const dataset=raw.serialized?JSON.parse(raw.serialized):raw;if(!isDataset(dataset))continue;rows.push({id:key,name:dataset.profile.name,version:raw.baseVersion??null,source:key.includes('.pending')?'舊未同步備份':'舊瀏覽器帳本',dataset});}catch{/* Invalid or unowned values are not imported. */}
 }
 return rows;
}
export const differsFromCloud=(dataset,cloud)=>durableTradeJson(dataset)!==durableTradeJson(cloud);
