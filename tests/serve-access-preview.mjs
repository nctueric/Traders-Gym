// Test-only session fixtures. Requires an explicit disposable directory; never imported by app code.
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { sqliteAdapter } from '../server/sqlite-adapter.mjs';
import { OWNER_EMAIL, signIn, sha256 } from '../lib/auth-core.mjs';
const directory = resolve(process.argv[2] || '');
if (!directory.startsWith('/private/tmp/traders-gym-access-preview.')) throw new Error('An isolated preview directory is required');
mkdirSync(directory, { recursive: true });
const sqlite = new DatabaseSync(`${directory}/accounts.sqlite`); sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
  if (sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(file)) continue;
  sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8')); sqlite.prepare('INSERT INTO local_migrations VALUES(?)').run(file);
}
const db = sqliteAdapter(sqlite), owner = await signIn(db, { sub: 'UI-OWNER', email: OWNER_EMAIL, name: '測試管理者' });
const applicationToken = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
sqlite.prepare('INSERT INTO application_sessions(id,token_hash,google_sub,email,name,expires_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), await sha256(applicationToken), `UI-APPLICANT-${Date.now()}`, `applicant.ui.${Date.now()}@gmail.com`, '測試申請人', new Date(Date.now() + 3600000).toISOString());
const server = createServer((req, res) => {
  if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) { res.writeHead(403); res.end(); return; }
  const applicant = req.url === '/applicant', isOwner = req.url === '/owner';
  if (!applicant && !isOwner) { res.writeHead(404); res.end(); return; }
  res.writeHead(303, { 'Set-Cookie': [`tg_session=${isOwner ? owner.token : ''}; HttpOnly; SameSite=Lax; Path=/`, `tg_application=${applicant ? applicationToken : ''}; HttpOnly; SameSite=Lax; Path=/`], Location: `http://127.0.0.1:3002/${applicant ? 'apply' : 'admin'}`, 'Cache-Control': 'no-store' }); res.end();
});
server.listen(3003, '127.0.0.1', () => console.log('Isolated fixtures: http://127.0.0.1:3003/applicant and /owner'));
