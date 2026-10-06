import { loadPerformanceHistory } from './performance-history.mjs';

// IndexedDB contains derived prices only; ledger recovery/storage is never touched.
/** @param {string} scope @param {any} [memoryStorage] */
export function browserPerformanceCache(scope, memoryStorage = null) {
 const key='performance-history-v1:'+scope;
 let database;
 const open=()=>database ||= new Promise((resolve,reject)=>{
  const request=indexedDB.open('tradergym-performance',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('history');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(new Error('歷史快取暫時無法開啟'));
 }).catch(error=>{database=null;throw error;});

 const transaction=async(mode,operation)=>{
  const db=await open();return new Promise((resolve,reject)=>{
   const tx=db.transaction('history',mode),request=operation(tx.objectStore('history'));
   tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
 };
 return {
  async read(){
   if(memoryStorage)return JSON.parse(memoryStorage.getItem(key)||'null');
   try {const saved=await transaction('readonly',store=>store.get(key));if(saved)return saved;}catch{/* Existing local cache can still be read if IndexedDB is unavailable. */}
   return JSON.parse(localStorage.getItem(key)||'null');
  },
  async write(cache){
   if(memoryStorage){memoryStorage.setItem(key,JSON.stringify(cache));return;}
   await transaction('readwrite',store=>store.put(cache,key));
   // Remove the old duplicate only after the new durable write succeeds.
   try{localStorage.removeItem(key);}catch{/* Migration cleanup is optional. */}
  }
 };
}

export function createPerformanceHistoryResource({storage,fetcher,now=()=>Date.now()}) {
 /** @type {{history: Awaited<ReturnType<typeof loadPerformanceHistory>> | null, status:string, loading:boolean}} */
 let state={history:null,status:'準備歷史資料…',loading:false},cache=null,hydrated=false;
 let current=null,controller=null,generation=0,lastTargets=[],saveChain=Promise.resolve(),cacheWarning='';
 const listeners=new Set();
 const publish=patch=>{state={...state,...patch};for(const listener of listeners)listener();};
 let pendingWrite=null,writing=false;
 const persist=value=>{
  // Coalesce waiting checkpoints: keep the in-flight write and newest snapshot,
  // instead of holding many copies of a multi-megabyte history in a long queue.
  pendingWrite=value;
  if(writing)return;
  writing=true;
  saveChain=(async()=>{
   while(pendingWrite){const next=pendingWrite;pendingWrite=null;
    try{await storage.write(next);cacheWarning='';}
    catch{cacheWarning='；快取未保存，可繼續使用並重試';publish({status:state.status.includes('快取未保存')?state.status:state.status+cacheWarning});}
   }
   writing=false;
  })();
 };
 async function load(targets,{force=false}={}) {
  const signature=JSON.stringify(targets);
  if(current?.signature===signature&&!force)return current.promise;
  controller?.abort();controller=new AbortController();const signal=controller.signal,run=++generation;
  lastTargets=targets;publish({loading:true,status:'正在補齊歷史資料…'});
  const promise=(async()=>{
   if(!hydrated){try{const saved=await storage.read();if(run!==generation)return;if(saved?.version===1)cache=saved;}catch{cacheWarning='；無法讀取快取，重新下載';}hydrated=true;}
   if(run!==generation)return;
   if(cache)publish({history:{cache,errors:[]}});
   try{
    const result=await loadPerformanceHistory(targets,cache,fetcher,signal,(done,total)=>{
     if(run===generation)publish({status:`讀取歷史資料 ${done}／${total}${cacheWarning}`});
    },{now:now(),force,checkpoint:value=>{
     if(run!==generation)return;cache=value;persist(value);
     publish({history:{cache:value,errors:[]}});
    }});
    if(run!==generation)return;
    cache=result.cache;persist(cache);await saveChain;
    if(run!==generation)return;
    publish({history:result,loading:false,status:(result.errors.length?`${result.errors.length} 個行情區間待補`:'歷史資料已就緒')+cacheWarning});
   }catch{if(run===generation&&!signal.aborted)publish({loading:false,status:'歷史資料讀取失敗，請重試'});}
   finally{if(run===generation)current=null;}
  })();
  current={signature,promise};return promise;
 }
 return {subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},getSnapshot:()=>state,
  load,retry:()=>load(lastTargets),refresh:()=>load(lastTargets,{force:true}),
  dispose(){generation++;controller?.abort();current=null;},flush:()=>saveChain};
}
