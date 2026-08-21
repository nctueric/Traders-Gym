import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, basename } from "node:path";
import { importTraderX2Csv } from "../lib/trader-x2-importer.mjs";
import { summarize } from "../lib/trade-engine.mjs";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error("需要來源CSV與目的JSON路徑");
const dataset = importTraderX2Csv(await readFile(source, "utf8"), basename(source));
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
const report = summarize(dataset);
const sides = dataset.fills.reduce((result, fill) => ({ ...result, [fill.side]: (result[fill.side] || 0) + 1 }), {});
const markets = dataset.fills.reduce((result, fill) => ({ ...result, [fill.market]: (result[fill.market] || 0) + 1 }), {});
const symbols = [...new Set(dataset.fills.map((fill) => fill.symbol))];
console.log(JSON.stringify({ destination, sourceRows: dataset.source.rowCount, fills: dataset.fills.length, cashActivities: dataset.cashActivities, dateRange: [dataset.fills.at(-1)?.timestamp, dataset.fills[0]?.timestamp], sides, markets, symbols: symbols.length, cycles: report.cycles.length, positions: report.positions.length, issues: report.issues }, null, 2));
