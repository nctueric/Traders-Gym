import { encodeSnapshotRequest } from "./snapshot-transport.mjs";
import { completeTradeJson, durableTradeJson, isDataset } from "./trade-record-store.mjs";
import { reconcileTradeSnapshots } from "./trade-snapshot.mjs";

export function createRecordSaveQueue() {
  let tail = Promise.resolve();
  /** @template T @param {() => T | Promise<T>} operation @returns {Promise<T>} */
  function enqueue(operation) {
    const task = tail.then(operation);
    tail = task.then(() => {}, () => {});
    return task;
  }
  return enqueue;
}

export function browserRecordStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function storageError(message, status) {
  return Object.assign(new Error(message), { status, retryable: !status || status >= 500 || status === 429 });
}

export async function saveTradeRecord({ accountId, accountName, serialized, baseVersion, baselineJson, saveMode = "manual", fetcher = globalThis.fetch }) {
  const request = async (method, body) => {
    const encoded = body ? await encodeSnapshotRequest(body) : {};
    let response;
    const signal = AbortSignal.timeout(60_000);
    try { response = await fetcher(method === "GET" ? `/api/trade-records?accountId=${encodeURIComponent(accountId)}` : "/api/trade-records", {
      method, cache: "no-store", signal,
      ...encoded,
    });
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) throw error;
      if (signal.aborted || ['AbortError', 'TimeoutError'].includes(error?.name) || /fetch is aborted/i.test(error?.message || '')) {
        throw Object.assign(storageError("雲端儲存連線逾時或中斷；尚未確認儲存成功，請重試", 504), { uncertainWrite: method === "PUT" });
      }
      throw error;
    }
    let payload;
    try { payload = await response.json(); }
    catch {
      // Gateways may return HTML (including Workers resource-limit pages).
      // Preserve HTTP failure semantics instead of exposing a browser JSON SyntaxError.
      throw storageError(`雲端儲存服務回應異常（HTTP ${response.status}，無法讀取資料）；尚未確認儲存成功`, response.ok ? 502 : response.status);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw storageError("雲端儲存服務回應格式異常；尚未確認儲存成功", 502);
    if (response.ok && (!payload.account || !Number.isInteger(payload.account.version) || (method === "GET" && !isDataset(payload.dataset)))) throw storageError("雲端未回傳有效儲存版本；尚未確認儲存成功", 502);
    return { response, payload };
  };
  let version = baseVersion;
  let mergedDataset;
  const reconcile = (server) => {
    const merged = reconcileTradeSnapshots(JSON.parse(serialized), server, baselineJson);
    if (!merged) throw storageError("另一頁籤與本頁都有修改；已停止覆寫，請先匯出本機備份再確認版本", 409);
    mergedDataset = merged;
    serialized = completeTradeJson(merged);
  };
  // A restored offline account must first establish its server baseline.
  if (version == null) {
    const { response, payload } = await request("GET");
    if (!response.ok && response.status !== 404) throw storageError(payload.error || `HTTP ${response.status}`, response.status);
    if (response.ok) {
      const serverJson = completeTradeJson(payload.dataset);
      if (serverJson === serialized) return { account: payload.account, serialized: serverJson };
      reconcile(payload.dataset);
      version = payload.account.version;
    }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // The same complete snapshot is used by manual and automatic saving.
    const body = `{"accountId":${JSON.stringify(accountId)},"accountName":${JSON.stringify(accountName)},"dataset":${serialized},"baseVersion":${JSON.stringify(version)},"saveMode":${JSON.stringify(saveMode)}}`;
    let result;
    try { result = await request("PUT", body); }
    catch (error) {
      if (!error.uncertainWrite) throw error;
      // A timed-out upload may already have committed. Confirm before offering a retry.
      try {
        const latest = await request("GET");
        if (latest.response.ok && completeTradeJson(latest.payload.dataset) === serialized) {
          return { account: latest.payload.account, serialized, dataset: latest.payload.dataset };
        }
      } catch (verificationError) {
        if ([401, 403].includes(verificationError?.status)) throw verificationError;
      }
      throw error;
    }
    const { response, payload } = result;
    if (response.ok) return { account: payload.account, serialized, ...(mergedDataset ? { dataset: mergedDataset } : {}) };
    if (response.status !== 409) throw storageError(payload.error || `HTTP ${response.status}`, response.status);
    const latest = await request("GET");
    if (!latest.response.ok) throw storageError(latest.payload.error || "無法確認最新紀錄", latest.response.status);
    const serverJson = completeTradeJson(latest.payload.dataset);
    if (serverJson === serialized) {
      return { account: latest.payload.account, serialized: serverJson, dataset: latest.payload.dataset };
    }
    reconcile(latest.payload.dataset);
    if (serialized === serverJson) return { account: latest.payload.account, serialized, dataset: latest.payload.dataset };
    version = latest.payload.account.version;
  }
  throw storageError("資料版本持續變動；請先匯出本機備份再確認版本", 409);
}

export function writeLocalRecord(storage, key, accountId, serialized, baselineJson, baseVersion) {
  try {
    // Emergency journal only. Complete snapshots belong in the verified file store.
    serialized = durableTradeJson(JSON.parse(serialized));
    baselineJson = baselineJson ? durableTradeJson(JSON.parse(baselineJson)) : "";
    storage.setItem(`${key}.${accountId}.pending`, JSON.stringify({ serialized, baselineJson, baseVersion }));
    storage.setItem(`${key}.${accountId}`, serialized);
    storage.setItem(key, serialized);
    return true;
  } catch { return false; }
}

export function readPendingRecord(storage, key, accountId, serverDataset) {
  const serverJson = durableTradeJson(serverDataset);
  try {
    const text = storage.getItem(`${key}.${accountId}.pending`);
    if (text) {
      const pending = JSON.parse(text);
      const candidate = JSON.parse(pending.serialized);
      if (!isDataset(candidate)) throw new Error("Invalid pending dataset");
      const pendingJson = durableTradeJson(candidate);
      const baselineJson = pending.baselineJson ? durableTradeJson(JSON.parse(pending.baselineJson)) : "";
      if (pendingJson === serverJson || pendingJson === baselineJson) return { dataset: serverDataset };
      // Cloud is authoritative on every login. Preserve unsynced bytes without
      // applying them to the displayed ledger or automatically uploading them.
      const recoveryKey = `${key}.${accountId}.recovery.${Date.now()}.${globalThis.crypto.randomUUID()}`;
      try { storage.setItem(recoveryKey, text); }
      catch { return { dataset: serverDataset, conflict: true, recoveryWarning: true }; }
      return { dataset: serverDataset, archivedPending: true, recoveryKey };

    }
    const legacy = storage.getItem(`${key}.${accountId}`);
    if (legacy && durableTradeJson(JSON.parse(legacy)) !== serverJson) {
      // Without a baseline, never guess whether this is newer or stale.
      // Keep the original bytes separately before the normal cache is refreshed.
      const recoveryKey = `${key}.${accountId}.recovery.${Date.now()}`;
      storage.setItem(recoveryKey, legacy);
      return { dataset: serverDataset, archivedPending: true, legacyRecoveryKey: recoveryKey };
    }
  } catch { return { dataset: serverDataset, conflict: true, recoveryWarning: true }; }
  return { dataset: serverDataset };
}

// Refresh only a clean local ledger. The caller rechecks after the network read.
export function canRefreshCloudRecord(serialized, baselineJson) {
  if (!baselineJson) return false;
  try { return durableTradeJson(JSON.parse(serialized)) === durableTradeJson(JSON.parse(baselineJson)); }
  catch { return false; }
}
