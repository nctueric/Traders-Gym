export const DEFAULT_RECORD_ACCOUNT_ID = "primary";
export const RECORD_ACCOUNT_KEY = "trade-review.active-account.v1";

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

export function validateTradeRecordPayload(value) {
  if (!value || typeof value !== "object") return { ok: false, error: "請提供交易帳號資料" };
  const accountId = typeof value.accountId === "string" ? value.accountId.trim() : "";
  const accountName = typeof value.accountName === "string" ? value.accountName.trim() : "";
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(accountId)) return { ok: false, error: "交易帳號識別碼格式無效" };
  if (!accountName || accountName.length > 100) return { ok: false, error: "交易帳號名稱格式無效" };
  if (!isDataset(value.dataset)) return { ok: false, error: "交易紀錄資料格式無效" };
  const datasetJson = JSON.stringify(value.dataset);
  if (datasetJson.length > 5_000_000) return { ok: false, error: "交易紀錄超過 5 MB 上限" };
  const baseVersion = value.baseVersion == null ? null : Number(value.baseVersion);
  if (baseVersion != null && (!Number.isInteger(baseVersion) || baseVersion < 0)) return { ok: false, error: "資料版本格式無效" };
  return { ok: true, accountId, accountName, dataset: value.dataset, datasetJson, baseVersion };
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
