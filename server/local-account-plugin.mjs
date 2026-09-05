import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createAccountApi } from "../lib/account-api.mjs";
import { sqliteAdapter } from "./sqlite-adapter.mjs";
import { createLocalRecordStore } from "./local-record-store.mjs";

export function localAccountPlugin({ directory, clientId = "", migrations }) {
  return { name: "traders-gym-local-accounts", apply: "serve", enforce: "pre", configureServer(server) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const sqlite = new DatabaseSync(join(directory, "accounts.sqlite"));
    sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)");
    for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
      if (sqlite.prepare("SELECT name FROM local_migrations WHERE name = ?").get(name)) continue;
      sqlite.exec("BEGIN IMMEDIATE");
      try { sqlite.exec(readFileSync(join(migrations, name), "utf8")); sqlite.prepare("INSERT INTO local_migrations VALUES (?)").run(name); sqlite.exec("COMMIT"); }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    }
    const api = createAccountApi({ db: sqliteAdapter(sqlite), clientId, files: createLocalRecordStore(directory) });
    server.httpServer?.once("close", () => sqlite.close());
    server.middlewares.use(async (req, res, next) => {
      const path = (req.url || "").split("?")[0];
      if (!(path === "/api/trade-records" || path.startsWith("/api/auth/") || path.startsWith("/api/admin/"))) return next();
      try {
        const host = req.headers.host || "";
        if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) { res.writeHead(403); res.end(); return; }
        const chunks = []; let size = 0;
        const max = path === "/api/trade-records" ? 51_000_000 : 20_000;
        for await (const chunk of req) { size += chunk.length; if (size > max) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value != null) headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const request = new Request(`http://${host}${req.url}`, { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        const response = await api.handle(request);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch { res.writeHead(500, { "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: "本機帳號服務暫時無法使用" })); }
    });
  } };
}
