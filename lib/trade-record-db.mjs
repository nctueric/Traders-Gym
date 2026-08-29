// The version check belongs in the write statement, not in a preceding SELECT.
// NULL/0 creates a new account only; it cannot overwrite an existing account.
export async function writeTradeRecord(db, checked, updatedAt = new Date().toISOString()) {
  const expected = checked.baseVersion ?? 0;
  return db.prepare(`INSERT INTO trade_account_snapshots (account_id, account_name, dataset_json, version, updated_at)
    SELECT ?, ?, ?, 1, ?
    WHERE ? = 0 OR EXISTS (SELECT 1 FROM trade_account_snapshots WHERE account_id = ? AND version = ?)
    ON CONFLICT(account_id) DO UPDATE SET
      account_name = excluded.account_name,
      dataset_json = excluded.dataset_json,
      version = trade_account_snapshots.version + 1,
      updated_at = excluded.updated_at
    WHERE trade_account_snapshots.version = ?
    RETURNING version, updated_at`).bind(checked.accountId, checked.accountName, checked.datasetJson, updatedAt, expected, checked.accountId, expected, expected).first();
}
