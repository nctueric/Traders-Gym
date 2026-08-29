import { mkdir, readFile, readdir, open, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { durableTradeJson, validateTradeRecordPayload } from "../lib/trade-record-store.mjs";

const accountPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const error = (message, status) => Object.assign(new Error(message), { status });
const digest = dataset => createHash("sha256").update(JSON.stringify(dataset)).digest("hex");

export function createLocalRecordStore(directory) {
  const root = resolve(directory), queues = new Map();
  const currentPath = id => {
    if (!accountPattern.test(id)) throw error("交易帳號識別碼格式無效", 400);
    return join(root, "目前帳號", `${id}.json`);
  };
  async function read(accountId) {
    let text;
    try { text = await readFile(currentPath(accountId), "utf8"); }
    catch (cause) { if (cause.code === "ENOENT") return null; throw cause; }
    try {
      const { _storage, ...dataset } = JSON.parse(text);
      if (!_storage || _storage.accountId !== accountId || !Number.isSafeInteger(_storage.version) || _storage.sha256 !== digest(dataset)) throw new Error("checksum mismatch");
      return { account: { id: accountId, name: _storage.accountName, version: _storage.version, updatedAt: _storage.updatedAt }, dataset, lastArchivedAt: _storage.lastArchivedAt || _storage.updatedAt };
    } catch { throw error(`帳號 ${accountId} 的檔案未通過完整性檢查；已停止覆寫，請檢查歷史備份`, 500); }
  }
  async function list() {
    let names;
    try { names = await readdir(join(root, "目前帳號")); }
    catch (cause) { if (cause.code === "ENOENT") return []; throw cause; }
    const records = await Promise.all(names.filter(name => name.endsWith(".json")).map(name => read(name.slice(0, -5))));
    return records.filter(Boolean).map(record => record.account).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async function syncedWrite(path, contents) {
    const handle = await open(path, "wx", 0o600);
    try { await handle.writeFile(contents, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
  }
  async function save(payload, { initialVersion = 1 } = {}) {
    const checked = validateTradeRecordPayload(payload, { maxBytes: 50_000_000 });
    if (!checked.ok) throw error(checked.error, 400);
    const id = checked.accountId, previousTask = queues.get(id) || Promise.resolve();
    const task = previousTask.catch(() => {}).then(async () => {
      const destination = currentPath(id), archiveDirectory = join(root, "歷史備份", id);
      await mkdir(join(root, "目前帳號"), { recursive: true, mode: 0o700 });
      await mkdir(archiveDirectory, { recursive: true, mode: 0o700 });
      const lockPath = join(root, "目前帳號", `${id}.lock`);
      let lock;
      try { lock = await open(lockPath, "wx", 0o600); }
      catch (cause) { if (cause.code === "EEXIST") throw error("此帳號資料夾正在寫入或保留中斷鎖定；請稍後重試，勿同時啟動兩個服務", 503); throw cause; }
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        const current = await read(id);
        if (current ? checked.baseVersion !== current.account.version : checked.baseVersion != null && checked.baseVersion !== 0) throw error("此帳號已有不同版本，已停止覆寫", 409);
        if (current?.dataset.marketSnapshot && !checked.dataset.marketSnapshot) throw error("此頁面使用舊版儲存格式；請先匯出備份並重新載入，避免遺失行情快照", 400);
        const version = current ? current.account.version + 1 : initialVersion;
        if (!Number.isSafeInteger(version) || version < 1) throw error("初始化版本無效", 400);
        const updatedAt = new Date().toISOString();
        const archiveNeeded = payload.saveMode !== "auto" || !current || durableTradeJson(current.dataset) !== durableTradeJson(checked.dataset) || Date.now() - Date.parse(current.lastArchivedAt) >= 30 * 60_000;
        const metadata = { accountId: id, accountName: checked.accountName, version, updatedAt, sha256: digest(checked.dataset), format: "trade-review-local-v2", lastArchivedAt: archiveNeeded ? updatedAt : current.lastArchivedAt };
        const contents = `${JSON.stringify({ ...checked.dataset, _storage: metadata }, null, 2)}\n`;
        // Archive first. If any write fails, the existing current file stays intact.
        const archive = join(archiveDirectory, `v${String(version).padStart(8, "0")}-${randomUUID()}.json`);
        if (archiveNeeded) await syncedWrite(archive, contents);
        await syncedWrite(temporary, contents);
        await rename(temporary, destination);
        return { account: { id, name: checked.accountName, version, updatedAt } };
      } finally {
        await unlink(temporary).catch(cause => { if (cause.code !== "ENOENT") throw cause; });
        await lock.close();
        await unlink(lockPath);
      }
    });
    queues.set(id, task);
    try { return await task; } finally { if (queues.get(id) === task) queues.delete(id); }
  }
  return { root, read, list, save };
}

export function localRecordMiddleware(store) {
  return async (req, res, next) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/api/trade-records") return next();
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(body));
    };
    try {
      const host = req.headers.host || "";
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw error("僅允許本機存取交易資料夾", 403);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) throw error("不允許其他網站存取交易資料夾", 403);
      const storage = { type: "local-folder", path: store.root };
      if (req.method === "GET") {
        const id = url.searchParams.get("accountId");
        if (!id) return send(200, { accounts: await store.list(), storage });
        const record = await store.read(id);
        return record ? send(200, { ...record, storage }) : send(404, { error: "找不到交易帳號" });
      }
      if (req.method !== "PUT") return send(405, { error: "不支援的操作" });
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw error("請提供 JSON 格式", 415);
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 51_000_000) throw error("上傳資料超過 51 MB，請先保留備份", 413);
        chunks.push(chunk);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw error("JSON 資料格式無效", 400); }
      return send(200, { ...await store.save(payload), storage });
    } catch (cause) { send(cause.status || 500, { error: cause.message || "本機資料夾儲存失敗" }); }
  };
}

export function localRecordPlugin(directory) {
  const store = createLocalRecordStore(directory);
  return {
    name: "trade-review-local-records",
    apply: "serve",
    enforce: "pre",
    configureServer(server) { server.middlewares.use(localRecordMiddleware(store)); },
  };
}
