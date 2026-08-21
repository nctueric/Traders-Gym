import { readFile, writeFile } from "node:fs/promises";
import { classifyCashActivities } from "../lib/trader-x2-importer.mjs";

const [datasetPath, currency, accountId] = process.argv.slice(2);
if (!datasetPath || !currency || !accountId) throw new Error("需要資料路徑、幣別與帳戶ID");
const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const updated = classifyCashActivities(dataset, { currency, accountId });
await writeFile(datasetPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ classified: updated.cashActivities.length, currency, accountId, requiresReview: updated.cashActivities.filter((activity) => activity.requiresReview).length }, null, 2));
