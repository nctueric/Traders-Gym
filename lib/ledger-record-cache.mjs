import { isDataset } from './trade-record-store.mjs';

const DATABASE = 'tradergym-ledger-cache';
const STORE = 'records';
const SCHEMA = 1;
let writeTail = Promise.resolve();

function cacheKey(userId, accountId) { return `${userId}:${accountId}`; }

export function usableCachedTradeRecord(entry, { userId, accountId, version }) {
  if (!entry || entry.schema !== SCHEMA || entry.key !== cacheKey(userId, accountId)) return null;
  const record = entry.record;
  if (!record || record.account?.id !== accountId || record.account.version !== version || !isDataset(record.dataset)) return null;
  if (entry.pending) {
    try { if (!isDataset(JSON.parse(entry.baselineJson))) return null; }
    catch { return null; }
  }
  return { ...record, cacheSource: 'device', cachePending: Boolean(entry.pending), cacheBaselineJson: entry.pending ? entry.baselineJson : undefined };
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

async function writeRecord({ userId, record, pending, baselineJson }) {
  if (typeof indexedDB === 'undefined' || !record?.account?.id || !Number.isInteger(record.account.version) || !isDataset(record.dataset)) return false;
  if (pending) {
    try { if (!isDataset(JSON.parse(baselineJson))) return false; }
    catch { return false; }
  }
  let db;
  try {
    db = await openDatabase();
    const key = cacheKey(userId, record.account.id);
    await requestResult(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ key, schema: SCHEMA, cachedAt: new Date().toISOString(), pending, ...(pending ? { baselineJson } : {}), record: { account: record.account, accounts: record.accounts, dataset: record.dataset } }));
    return true;
  } catch { return false; }
  finally { db?.close(); }
}

export function writeLedgerRecordCache({ userId, record, pending = false, baselineJson = '' }) {
  const task = writeTail.then(() => writeRecord({ userId, record, pending, baselineJson }));
  writeTail = task.then(() => {}, () => {});
  return task;
}

export function clearLedgerRecordCache(userId) {
  const task = writeTail.then(async () => {
    if (typeof indexedDB === 'undefined' || typeof IDBKeyRange === 'undefined') return false;
    let db;
    try {
      db = await openDatabase();
      await requestResult(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(IDBKeyRange.bound(`${userId}:`, `${userId}:\uffff`)));
      return true;
    } catch { return false; }
    finally { db?.close(); }
  });
  writeTail = task.then(() => {}, () => {});
  return task;
}
