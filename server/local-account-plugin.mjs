import { createResendMailer } from '../lib/email-auth.mjs';
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { createPasswordAuth } from "../lib/password-auth.mjs";
import { createMixedAuthenticator } from "../lib/mixed-auth.mjs";
import { reviewCacheHandler } from "../lib/review-cache-api.mjs";
import { join } from "node:path";
import { createAccountApi } from "../lib/account-api.mjs";
import { Miniflare } from "miniflare";
import {unstable_splitSqlQuery} from "wrangler";
import {createPreferencesApi} from "../lib/member-preferences.mjs";
import {legacyFileRows} from "./legacy-record-reader.mjs";

export function localAccountPlugin({ directory, legacyDirectory = directory, clientId = "", migrations, personalEmail = "", passwordHash = "", applicationsOpen = false, openGoogleLogin = false, mailPreview = false, resendApiKey = "" }) {
  return { name: "traders-gym-local-accounts", apply: "serve", enforce: "pre", async configureServer(server) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    // Isolated D1/R2 emulation runs the same API and object-store code as production.
    const emulator = new Miniflare({modules:true,script:'export default {fetch(){return new Response("local");}}',compatibilityDate:'2026-05-01',d1Databases:['DB'],r2Buckets:['SNAPSHOTS'],d1Persist:join(directory,'d1'),r2Persist:join(directory,'r2')});
    const db = await emulator.getD1Database('DB'), objects = await emulator.getR2Bucket('SNAPSHOTS');
    await db.prepare('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)').run();
    for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
      if (await db.prepare('SELECT name FROM local_migrations WHERE name=?').bind(name).first()) continue;
      const statements=unstable_splitSqlQuery(readFileSync(join(migrations,name),'utf8'));
      await db.batch([...statements.map(sql=>db.prepare(sql)),db.prepare('INSERT INTO local_migrations VALUES(?)').bind(name)]);
    }
    const password = personalEmail && passwordHash ? createPasswordAuth({db,email:personalEmail,passwordHash}) : null;
    const authenticate = createMixedAuthenticator(db, password);
    const sendMail=mailPreview ? async message=>{await mkdir(join(directory,'mail-preview'),{recursive:true,mode:0o700});await writeFile(join(directory,'mail-preview',crypto.randomUUID()+'.json'),JSON.stringify(message),{mode:0o600});} : createResendMailer({apiKey:resendApiKey});
    const api = createAccountApi({ db, clientId, objects, authenticate, accessOptions: { sendMail, password, ownerEmail: personalEmail, applicationsOpen, openGoogleLogin } });
    const preferences = createPreferencesApi({db,authenticate});
    server.httpServer?.once("close", () => {void emulator.dispose();});
    server.middlewares.use(async (req, res, next) => {
      const path = (req.url || "").split("?")[0];
      if (!(path === "/api/preferences" || path === "/api/legacy-records" || path === "/api/ledgers" || path === "/api/review-valuations" || path === "/api/trade-records" || path.startsWith("/api/auth/") || path.startsWith("/api/admin/"))) return next();
      try {
        const host = req.headers.host || "";
        if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) { res.writeHead(403); res.end(); return; }
        const chunks = []; let size = 0;
        const max = path === "/api/trade-records" ? 51_000_000 : path === "/api/review-valuations" ? 4_000_000 : 20_000;
        for await (const chunk of req) { size += chunk.length; if (size > max) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value != null) headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const request = new Request(`http://${host}${req.url}`, { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        const response = path === "/api/legacy-records" ? await legacyFileRows(request,{authenticate,directory:legacyDirectory}) : path === "/api/preferences" ? await preferences(request) : path === "/api/review-valuations" ? await reviewCacheHandler(request,{db,objects,authenticate}) : await api.handle(request);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => { if (key !== "set-cookie") res.setHeader(key, value); });
        if (response.headers.getSetCookie().length) res.setHeader("set-cookie", response.headers.getSetCookie());
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch { res.writeHead(500, { "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: "本機帳號服務暫時無法使用" })); }
    });
  } };
}
