import {diffNormalizedDatasets,createLedgerMutation} from './ledger-mutations.mjs';
import { isDataset } from './trade-record-store.mjs';

const DATABASE = 'tradergym-ledger-cache';
const STORE = 'records';
const SCHEMA = 1;
let writeTail = Promise.resolve();
const writerId = globalThis.crypto?.randomUUID?.() || String(Math.random());

function cacheKey(userId, accountId) { return `${userId}:${accountId}`; }

export function usableCachedTradeRecord(entry, { userId, accountId, version }) {
  if (!entry || entry.schema !== SCHEMA || entry.key !== cacheKey(userId, accountId)) return null;
  const record = entry.record;
  if (!record || record.account?.id !== accountId || (!entry.pending && record.account.version !== version) || !isDataset(record.dataset)) return null;
  if (entry.pending) {
    try { if (!isDataset(JSON.parse(entry.baselineJson))) return null; }
    catch { return null; }
  }
  return { ...record, cacheConflict: Boolean(entry.pending && record.account.version !== version), cacheRetryAt: entry.retryAt, cacheRetryCode: entry.retryCode, cacheSource: 'device', cachePending: Boolean(entry.pending), cacheBaselineJson: entry.pending ? entry.baselineJson : undefined };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, SCHEMA);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('帳本快取無法開啟'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('帳本快取操作失敗'));
  });
}

export async function readLedgerRecordCache({ userId, accountId, version }) {
  if (typeof indexedDB === 'undefined') return null;
  let db;
  try {
    db = await openDatabase();
    const entry = await requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).get(cacheKey(userId, accountId)));
    const record = usableCachedTradeRecord(entry, { userId, accountId, version });
    // Never discard an unconfirmed local edit merely because another device
    // advanced the cloud version. It stays isolated until a recovery flow can
    // reconcile it; only ordinary stale/corrupt cache entries are evicted.
    if (!record && entry && !entry.pending) await requestResult(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(entry.key));
    return record;
  } catch { return null; }
  finally { db?.close(); }
}

export async function readStaleLedgerRecordCache({userId,accountId,beforeVersion}){
  if(typeof indexedDB==='undefined')return null;let db;
  try{db=await openDatabase();const entry=await requestResult(db.transaction(STORE,'readonly').objectStore(STORE).get(cacheKey(userId,accountId)));const record=entry?.record;if(!entry||entry.schema!==SCHEMA||entry.pending||!record||record.account?.id!==accountId||!Number.isInteger(record.account.version)||record.account.version>=beforeVersion||!isDataset(record.dataset))return null;return {...record,cacheSource:'device-stale'};}
  catch{return null;}finally{db?.close();}
}

async function writeRecord({ userId, record, pending, baselineJson, retryAt, retryCode, acknowledgedJson, localEdit }) {
  if (typeof indexedDB === 'undefined' || !record?.account?.id || !Number.isInteger(record.account.version) || !isDataset(record.dataset)) return false;
  if (pending) {
    try { if (!isDataset(JSON.parse(baselineJson))) return false; }
    catch { return false; }
  }
  let db;
  try {
    db = await openDatabase();
    const key = cacheKey(userId, record.account.id);
    const pendingBatch=pending?await createLedgerMutation(record.account.id,record.account.version,diffNormalizedDatasets(JSON.parse(baselineJson),record.dataset)):null;
    const transaction=db.transaction(STORE,'readwrite'),store=transaction.objectStore(STORE);
    await new Promise((resolve,reject)=>{
      transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error||Error('本機儲存失敗'));transaction.onerror=()=>reject(transaction.error||Error('本機儲存失敗'));
      const read=store.get(key);
      read.onsuccess=()=>{
        const prior=read.result;
        if(prior?.pending && prior.writerId!==writerId && JSON.stringify(prior.record.dataset)!==JSON.stringify(record.dataset)) {
          // Preserve another tab's unconfirmed edit as a separate recovery record.
          store.put({...prior,key:`${key}:recovery:${prior.writerId||'legacy'}:${prior.cachedAt}`});
        }
        if(prior?.pending && !pending && !(localEdit&&prior.writerId===writerId) && (!acknowledgedJson || diffNormalizedDatasets(prior.record.dataset,JSON.parse(acknowledgedJson)).length)) {
          // Loading a server record must never erase unconfirmed local edits.
          return;
        }
        store.put({key,schema:SCHEMA,writerId,pendingBatch,revision:(prior?.revision||0)+1,cachedAt:new Date().toISOString(),pending,retryAt,retryCode,...(pending?{baselineJson}:{}),record:{account:record.account,accounts:record.accounts,dataset:record.dataset}});
      };
    });
    return true;
  } catch { return false; }
  finally { db?.close(); }
}

export function writeLedgerRecordCache({ userId, record, pending = false, baselineJson = '', retryAt = '', retryCode = '', acknowledgedJson = '', localEdit = false }) {
  const task = writeTail.then(() => writeRecord({ userId, record, pending, baselineJson, retryAt, retryCode, acknowledgedJson, localEdit }));
  writeTail = task.then(() => {}, () => {});
  return task;
}

export function clearLedgerRecordCache(userId,accountId = '') {
  const task = writeTail.then(async () => {
    if (typeof indexedDB === 'undefined' || typeof IDBKeyRange === 'undefined') return false;
    let db;
    try {
      db = await openDatabase();
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);if(accountId){const key=cacheKey(userId,accountId);store.delete(key);store.delete(IDBKeyRange.bound(`${key}:recovery:`,`${key}:recovery:\uffff`));}else store.delete(IDBKeyRange.bound(`${userId}:`,`${userId}:\uffff`));});
      return true;
    } catch { return false; }
    finally { db?.close(); }
  });
  writeTail = task.then(() => {}, () => {});
  return task;
}

export async function readLedgerRecoveryRecords(userId,accountId){
 if(typeof indexedDB==='undefined')return [];let db;
 try{db=await openDatabase();const entries=await requestResult(db.transaction(STORE,'readonly').objectStore(STORE).getAll());return entries.filter(e=>e.key.startsWith(`${cacheKey(userId,accountId)}:recovery:`)).map(e=>({cachedAt:e.cachedAt,dataset:e.record.dataset}));}finally{db?.close();}
}
