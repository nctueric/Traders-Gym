import { encodeSnapshotRequest } from "./snapshot-transport.mjs";
import { completeTradeJson, isDataset } from "./trade-record-store.mjs";
import { reconcileTradeSnapshots } from "./trade-snapshot.mjs";
import {diffNormalizedDatasets,createLedgerMutation} from './ledger-mutations.mjs';

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

function storageError(message, status, details = {}) {
  return Object.assign(new Error(message), { status, code: details.code, retryAt: details.retryAt, retryable: !status || status >= 500 || status === 429 });
}

export async function saveTradeRecord({ accountId, accountName, serialized, baseVersion, baselineJson, saveMode = "manual", incremental = false, conflictAttempt = 0, fetcher = globalThis.fetch }) {
  const uncertain = (error, method) => method === "PUT" ? Object.assign(error, { uncertainWrite: true }) : error;
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
      throw uncertain(storageError(`雲端儲存服務回應異常（HTTP ${response.status}，無法讀取資料）；尚未確認儲存成功`, response.ok ? 502 : response.status), method);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw uncertain(storageError("雲端儲存服務回應格式異常；尚未確認儲存成功", 502), method);
    if (response.ok && (!payload.account || !Number.isInteger(payload.account.version) || (method === "GET" && !isDataset(payload.dataset)))) throw uncertain(storageError("雲端未回傳有效儲存版本；尚未確認儲存成功", 502), method);
    return { response, payload };
  };
  let version = baseVersion;
  let mergedDataset;
  const reconcile = (server) => {
    const merged = reconcileTradeSnapshots(JSON.parse(serialized), server, baselineJson);
    if (!merged) throw storageError("另一頁籤與本頁都有修改；已停止覆寫，請先匯出當頁版本再確認版本", 409);
    mergedDataset = merged;
    serialized = completeTradeJson(merged);
  };
  // A restored offline account must first establish its server baseline.
  if (version == null) {
    const { response, payload } = await request("GET");
    if (!response.ok && response.status !== 404) throw storageError(payload.error || `HTTP ${response.status}`, response.status, payload);
    if (response.ok) {
      const serverJson = completeTradeJson(payload.dataset);
      if (serverJson === serialized) return { account: payload.account, serialized: serverJson };
      reconcile(payload.dataset);
      version = payload.account.version;
    }
  }
  if (baselineJson && Number.isInteger(version) && canRefreshCloudRecord(serialized, baselineJson)) {
    return {account:{id:accountId,name:accountName,version}, serialized, unchanged:true};
  }
  if(incremental&&Number.isInteger(version)&&baselineJson){
    let operations;try{operations=diffNormalizedDatasets(JSON.parse(baselineJson),JSON.parse(serialized));}catch{throw storageError('帳本差異無法解析；已停止儲存，請匯出備份',400);}
    if(!operations.length)return {account:{id:accountId,name:accountName,version},serialized,unchanged:true};
    if(operations.length){
      const {mutationId}=await createLedgerMutation(accountId,version,operations),signal=AbortSignal.timeout(15_000);let response,payload;
      try{response=await fetcher(`/api/trade-records/${encodeURIComponent(accountId)}/mutations`,{method:'POST',cache:'no-store',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({baseVersion:version,mutationId,operations,saveMode})});payload=await response.json();}
      catch(error){if(signal.aborted||['AbortError','TimeoutError'].includes(error?.name))throw storageError('雲端增量儲存連線逾時；修改仍保留於當頁，請重試',504);throw error;}
      if(response.ok&&payload?.account&&Number.isInteger(payload.account.version))return {account:payload.account,serialized,sync:payload.sync};
      if(response.status===409&&conflictAttempt<1){
        const latest=await request('GET');
        if(!latest.response.ok)throw storageError(latest.payload.error||'無法取得最新帳本',latest.response.status,latest.payload);
        reconcile(latest.payload.dataset);
        const saved=await saveTradeRecord({accountId,accountName,serialized,baseVersion:latest.payload.account.version,baselineJson:completeTradeJson(latest.payload.dataset),saveMode,incremental:true,conflictAttempt:conflictAttempt+1,fetcher});
        return {...saved,dataset:mergedDataset};
      }
      throw storageError(payload?.error||`HTTP ${response.status}`,response.status,payload);
    }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // The same complete snapshot is used by manual and automatic saving.
    const body = `{"accountId":${JSON.stringify(accountId)},"accountName":${JSON.stringify(accountName)},"dataset":${serialized},"baseVersion":${JSON.stringify(version)},"saveMode":${JSON.stringify(saveMode)}}`;
    let result;
    for (let gatewayAttempt = 0; gatewayAttempt < 2; gatewayAttempt += 1) {
      try { result = await request("PUT", body); break; }
      catch (error) {
        if (!error.uncertainWrite) throw error;
        // A timeout or non-JSON gateway response may hide a successful commit.
        // Verify first; retry only when the cloud still exposes the exact base version.
        let latest;
        try {
          latest = await request("GET");
          if (latest.response.ok && completeTradeJson(latest.payload.dataset) === serialized) {
            return { account: latest.payload.account, serialized, dataset: latest.payload.dataset };
          }
        } catch (verificationError) {
          if ([401, 403].includes(verificationError?.status)) throw verificationError;
        }
        if (gatewayAttempt === 0 && latest?.response.ok && latest.payload.account.version === version) continue;
        throw error;
      }
    }
    const { response, payload } = result;
    if (response.ok) return { account: payload.account, serialized, ...(mergedDataset ? { dataset: mergedDataset } : {}) };
    if (response.status !== 409) throw storageError(payload.error || `HTTP ${response.status}`, response.status, payload);
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
  throw storageError("資料版本持續變動；請先匯出當頁版本再確認版本", 409);
}

// Refresh only a clean local ledger. The caller rechecks after the network read.
export function canRefreshCloudRecord(serialized, baselineJson) {
  if (!baselineJson) return false;
  try { return diffNormalizedDatasets(JSON.parse(baselineJson),JSON.parse(serialized)).length===0; }
  catch { return false; }
}
