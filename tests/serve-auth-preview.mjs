// TEST ONLY: synthetic identities in an explicitly selected temporary database.
// Never imported by the application or production build. No Google login bypass exists in app routes.
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { sqliteAdapter } from "../server/sqlite-adapter.mjs";
import { createAccountApi } from "../lib/account-api.mjs";
import { OWNER_EMAIL, signIn, sessionCookie } from "../lib/auth-core.mjs";
const directory = resolve(process.argv[2] || "");
if (!directory.startsWith("/private/tmp/traders-gym-auth-preview.")) throw new Error("Requires an isolated test directory");
const target = new URL(process.argv[3] || "http://127.0.0.1:3002");
if (target.hostname !== "127.0.0.1" || target.protocol !== "http:") throw new Error("Only loopback test URLs are allowed");
const sqlite = new DatabaseSync(`${directory}/accounts.sqlite`), db = sqliteAdapter(sqlite);
const api = createAccountApi({ db, clientId: "" });
const owner = await signIn(db, { sub: "TEST-OWNER", email: OWNER_EMAIL, name: "Eric（隔離測試）", email_verified: true });
const ownerRequest = new Request(`${target.origin}/api/admin/accounts`, { method: "POST", headers: { Origin: target.origin, Cookie: `tg_session=${owner.token}`, "x-workspace-session": owner.sessionId, "Content-Type": "application/json" }, body: JSON.stringify({ action: "invite", email: "team.qa@gmail.com" }) });
await api.handle(ownerRequest);
const member = await signIn(db, { sub: "TEST-MEMBER", email: "team.qa@gmail.com", name: "團隊成員（隔離測試）", email_verified: true });
const server = createServer((req, res) => {
  if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || "")) { res.writeHead(403); res.end(); return; }
  const path = new URL(req.url, target).pathname, session = path === "/owner" ? owner : path === "/member" ? member : null;
  if (!session) { res.writeHead(404); res.end(); return; }
  res.writeHead(303, { "Set-Cookie": sessionCookie(session.token, new Request(target)), Location: `${target.origin}${path === "/owner" ? "/admin" : "/"}`, "Cache-Control": "no-store" }); res.end();
});
server.listen(0, "127.0.0.1", () => console.log(`Synthetic preview: http://127.0.0.1:${server.address().port}/owner and /member`));
