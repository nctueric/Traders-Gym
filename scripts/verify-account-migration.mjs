// Read the selected backup and exercise the real migration/storage path in a temporary directory.
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createLocalRecordStore } from "../server/local-record-store.mjs";
import { sqliteAdapter } from "../server/sqlite-adapter.mjs";
import { createAccountApi } from "../lib/account-api.mjs";
import { OWNER_EMAIL, signIn } from "../lib/auth-core.mjs";
const source = process.argv[2]; if (!source) throw new Error("Provide a complete snapshot backup path");
const bytes = await readFile(source), { _storage, ...dataset } = JSON.parse(bytes.toString("utf8"));
const hash = value => createHash("sha256").update(value).digest("hex");
assert.equal(_storage.sha256, hash(JSON.stringify(dataset)), "source checksum");
const temporary = await mkdtemp(join(tmpdir(), "traders-gym-migration-")), sqlite = new DatabaseSync(":memory:");
try {
  for (const name of (await readdir(new URL("../drizzle/", import.meta.url))).filter(name => name.endsWith(".sql")).sort()) sqlite.exec(await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  const files = createLocalRecordStore(temporary), db = sqliteAdapter(sqlite), api = createAccountApi({ db, files, clientId: "" });
  await files.save({ accountId: "primary", accountName: _storage.accountName, dataset, baseVersion: 0 }, { initialVersion: _storage.version });
  const session = await signIn(db, { email: OWNER_EMAIL, sub: "migration-rehearsal-only", name: "migration", email_verified: true });
  const response = await api.handle(new Request("https://migration.example/api/trade-records", { headers: { Cookie: `tg_session=${session.token}`, "x-workspace-session": session.sessionId } }));
  assert.equal(response.status, 200); const restored = await response.json();
  assert.equal(restored.account.version, _storage.version); assert.deepEqual(restored.dataset, dataset);
  console.log(JSON.stringify({ sourceSha256: hash(bytes), datasetSha256: hash(JSON.stringify(dataset)), version: _storage.version, compactBytes: Buffer.byteLength(JSON.stringify(dataset)), sameDataset: true, sameVersion: true, productionModified: false }, null, 2));
} finally { sqlite.close(); await rm(temporary, { recursive: true, force: true }); }
