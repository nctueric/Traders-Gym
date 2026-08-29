export const DEFAULT_RECORD_ACCOUNT_ID = "primary";
export const RECORD_ACCOUNT_KEY = "trade-review.active-account.v1";

// A small user-edit fingerprint / emergency browser journal, NOT a complete backup.
export function durableTradeDataset(dataset) {
  const durable = { ...dataset, marketBars: [] };
  // Local snapshot files are directly importable; storage metadata is not a review field.
  delete durable._storage;
  delete durable.marketSnapshot;
  return durable;
}

// Preserve every known and future field. Only file-envelope metadata is excluded.
export function completeTradeDataset(dataset) {
  const complete = { ...dataset };
  delete complete._storage;
  return complete;
}

export function completeTradeJson(dataset) {
  return JSON.stringify(completeTradeDataset(dataset));
}

export function durableTradeJson(dataset) {
  return JSON.stringify(durableTradeDataset(dataset));
}

export function isDataset(value) {
  return Boolean(
    value
      && typeof value === "object"
      && value.profile
      && typeof value.profile.name === "string"
      && Array.isArray(value.accounts)
      && Array.isArray(value.fills)
      && Array.isArray(value.marketBars)
      && value.settings
      && typeof value.settings === "object"
  );
}

export function validateTradeRecordPayload(value, { maxBytes = 1_800_000 } = {}) {
  if (!value || typeof value !== "object") return { ok: false, error: "請提供交易帳號資料" };
  const accountId = typeof value.accountId === "string" ? value.accountId.trim() : "";
  const accountName = typeof value.accountName === "string" ? value.accountName.trim() : "";
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(accountId)) return { ok: false, error: "交易帳號識別碼格式無效" };
  if (!accountName || accountName.length > 100) return { ok: false, error: "交易帳號名稱格式無效" };
  if (!isDataset(value.dataset)) return { ok: false, error: "交易紀錄資料格式無效" };
  const dataset = completeTradeDataset(value.dataset);
  const datasetJson = JSON.stringify(dataset);
  // Leave headroom for the account name/row metadata below D1's row limit.
  if (new TextEncoder().encode(datasetJson).byteLength > maxBytes) return { ok: false, error: `完整快照超過 ${maxBytes / 1_000_000} MB 儲存上限；未刪減或寫入資料，請匯出備份並使用本機資料夾儲存` };
  const baseVersion = value.baseVersion == null ? null : Number(value.baseVersion);
  if (baseVersion != null && (!Number.isInteger(baseVersion) || baseVersion < 0)) return { ok: false, error: "資料版本格式無效" };
  return { ok: true, accountId, accountName, dataset, datasetJson, baseVersion };
}

export function selectStartupAccount(accounts, preferredId) {
  if (!Array.isArray(accounts) || !accounts.length) return null;
  return accounts.find((account) => account.id === preferredId) || accounts[0];
}

export function makeRecordAccountId(name, now = Date.now()) {
  const stem = String(name || "account")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36) || "account";
  return `${stem}-${now}`;
}
