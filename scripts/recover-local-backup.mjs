// Copies the source backup and adds only missing strategies/reviews to the
// matching ledger. Never replaces trades, cash, existing reviews, or plans.
import { readFile, mkdir, copyFile, constants } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createLocalRecordStore } from "../server/local-record-store.mjs";
import { summarize } from "../lib/trade-engine.mjs";

const [sourcePath, directory, accountId = "primary"] = process.argv.slice(2);
if (!sourcePath || !directory) throw new Error("請提供來源 JSON 與本機自動儲存資料夾");
const source = await readFile(sourcePath), backup = JSON.parse(source);
const store = createLocalRecordStore(directory), current = await store.read(accountId);
if (!current) throw new Error("請先建立目前帳號；此工具不會猜測帳號歸屬");
for (const key of ["accounts", "fills", "cashActivities"]) {
  if (JSON.stringify(backup[key]) !== JSON.stringify(current.dataset[key])) throw new Error(`${key} 與目前帳本不一致，已停止合併`);
}
const report = summarize(current.dataset), cycleIds = new Set(report.cycles.map(cycle => cycle.id));
const strategies = [...(current.dataset.strategies || [])], reviews = { ...(current.dataset.cycleReviews || {}) };
const addedStrategies = [], addedReviews = [], skipped = [];
for (const strategy of backup.strategies || []) {
  if (!strategies.some(item => item.id === strategy.id)) { strategies.push(strategy); addedStrategies.push(strategy.id); }
}
for (const [id, review] of Object.entries(backup.cycleReviews || {})) {
  if (!cycleIds.has(id)) { skipped.push(id); continue; }
  if (!(id in reviews)) { reviews[id] = review; addedReviews.push(id); }
}
const sourceDirectory = join(resolve(directory), "來源備份");
await mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
const sourceCopy = join(sourceDirectory, basename(sourcePath));
try { await copyFile(sourcePath, sourceCopy, constants.COPYFILE_EXCL); }
catch (error) { if (error.code !== "EEXIST" || !(await readFile(sourceCopy)).equals(source)) throw error; }
let account = current.account;
if (addedStrategies.length || addedReviews.length) {
  ({ account } = await store.save({ accountId, accountName: current.account.name, baseVersion: current.account.version, dataset: { ...current.dataset, strategies, cycleReviews: reviews } }));
}
console.log(JSON.stringify({ account, addedStrategies: addedStrategies.length, addedReviews: addedReviews.length, skipped, sourceCopy, sourceSha256: createHash("sha256").update(source).digest("hex"), fillCount: current.dataset.fills.length, cycleCount: report.cycles.length, positionCount: report.positions.length, ledgerChanged: false }, null, 2));
