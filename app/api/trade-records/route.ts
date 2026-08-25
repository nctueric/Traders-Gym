import { env } from "cloudflare:workers";
import { validateTradeRecordPayload } from "@/lib/trade-record-store.mjs";

type SnapshotRow = { account_id: string; account_name: string; dataset_json: string; version: number; updated_at: string };

function database() {
  if (!env.DB) throw new Error("交易資料庫尚未綁定");
  return env.DB;
}

export async function GET(request: Request) {
  try {
    const db = database();
    const accountId = new URL(request.url).searchParams.get("accountId")?.trim();
    if (!accountId) {
      const result = await db.prepare("SELECT account_id, account_name, version, updated_at FROM trade_account_snapshots ORDER BY updated_at DESC").all();
      const accounts = (result.results || []).map((row: Omit<SnapshotRow, "dataset_json">) => ({ id: row.account_id, name: row.account_name, version: row.version, updatedAt: row.updated_at }));
      return Response.json({ accounts }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(accountId)) return Response.json({ error: "交易帳號識別碼格式無效" }, { status: 400 });
    const row = await db.prepare("SELECT account_id, account_name, dataset_json, version, updated_at FROM trade_account_snapshots WHERE account_id = ?").bind(accountId).first() as SnapshotRow | null;
    if (!row) return Response.json({ error: "找不到交易帳號" }, { status: 404 });
    return Response.json({ account: { id: row.account_id, name: row.account_name, version: row.version, updatedAt: row.updated_at }, dataset: JSON.parse(row.dataset_json) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "交易紀錄讀取失敗" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const checked = validateTradeRecordPayload(body);
    if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
    const db = database();
    const current = await db.prepare("SELECT version FROM trade_account_snapshots WHERE account_id = ?").bind(checked.accountId).first() as { version: number } | null;
    if (current && checked.baseVersion != null && current.version !== checked.baseVersion) {
      return Response.json({ error: "此帳號已有較新的交易紀錄，請重新載入", currentVersion: current.version }, { status: 409 });
    }
    const updatedAt = new Date().toISOString();
    await db.prepare(`INSERT INTO trade_account_snapshots (account_id, account_name, dataset_json, version, updated_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        account_name = excluded.account_name,
        dataset_json = excluded.dataset_json,
        version = trade_account_snapshots.version + 1,
        updated_at = excluded.updated_at`).bind(checked.accountId, checked.accountName, checked.datasetJson, updatedAt).run();
    const saved = await db.prepare("SELECT version FROM trade_account_snapshots WHERE account_id = ?").bind(checked.accountId).first() as { version: number } | null;
    return Response.json({ account: { id: checked.accountId, name: checked.accountName, version: saved?.version || 1, updatedAt } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "交易紀錄儲存失敗" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
