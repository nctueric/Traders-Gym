import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createPasswordAuth } from "../lib/password-auth.mjs";
import { requireSession } from "../lib/auth-core.mjs";
import { reviewCacheHandler } from "../lib/review-cache-api.mjs";
import { join } from "node:path";
import { createAccountApi } from "../lib/account-api.mjs";
import { sqliteAdapter } from "./sqlite-adapter.mjs";
import { createLocalRecordStore } from "./local-record-store.mjs";

export function localAccountPlugin({ directory, clientId = "", migrations, personalEmail = "", passwordHash = "" }) {
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
    const db = sqliteAdapter(sqlite);
    const password = personalEmail && passwordHash ? createPasswordAuth({db,email:personalEmail,passwordHash}) : null;
    const authenticate = password ? password.authenticate : (request, options) => requireSession(db,request,options);
    const api = createAccountApi({ db, clientId, files: createLocalRecordStore(directory), ...(password ? {trial:true,authenticate} : {}) });
    const cacheDir = join(directory,"估值快取");
    const objects = {
      async get(key) {try {const saved=JSON.parse(await readFile(join(cacheDir,encodeURIComponent(key)+".json"),"utf8"));return {body:saved.body,customMetadata:saved.customMetadata};}catch(e){if(e.code==='ENOENT')return null;throw e;}},
      async put(key,body,options) {await mkdir(cacheDir,{recursive:true,mode:0o700});await writeFile(join(cacheDir,encodeURIComponent(key)+".json"),JSON.stringify({body,customMetadata:options.customMetadata}),{mode:0o600});return {};}
    };
    server.httpServer?.once("close", () => sqlite.close());
    server.middlewares.use(async (req, res, next) => {
      const path = (req.url || "").split("?")[0];
      if (!(path === "/api/review-valuations" || path === "/api/trade-records" || path.startsWith("/api/auth/") || path.startsWith("/api/admin/"))) return next();
      try {
        const host = req.headers.host || "";
        if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) { res.writeHead(403); res.end(); return; }
        const chunks = []; let size = 0;
        const max = path === "/api/trade-records" ? 51_000_000 : path === "/api/review-valuations" ? 4_000_000 : 20_000;
        for await (const chunk of req) { size += chunk.length; if (size > max) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value != null) headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const request = new Request(`http://${host}${req.url}`, { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        const response = path === "/api/auth/password" && password ? await password.login(request) : path === "/api/review-valuations" ? await reviewCacheHandler(request,{db,objects,authenticate}) : await api.handle(request);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch { res.writeHead(500, { "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: "本機帳號服務暫時無法使用" })); }
    });
  } };
}
