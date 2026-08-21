import { readFile } from "node:fs/promises";
import { summarize, validateDataset } from "../lib/trade-engine.mjs";

const [datasetPath] = process.argv.slice(2);
const data = JSON.parse(await readFile(datasetPath, "utf8"));
const report = summarize(data); const sorted = [...data.fills].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
const round = (value) => Math.round(value * 100) / 100;
const turnover = data.fills.reduce((result, fill) => {
  const key = `${fill.currency}_${fill.side}`; result[key] = (result[key] || 0) + fill.quantity * fill.price + (fill.side === "BUY" ? fill.fee : -fill.fee); return result;
}, {});
const output = {
  source: data.source,
  dateRangeUtc: [sorted[0]?.timestamp, sorted.at(-1)?.timestamp],
  fillCounts: { total: data.fills.length, buy: data.fills.filter((fill) => fill.side === "BUY").length, sell: data.fills.filter((fill) => fill.side === "SELL").length },
  turnover: Object.fromEntries(Object.entries(turnover).map(([key, value]) => [key, round(value)])),
  marketBars: { count: data.marketBars.length, source: data.marketDataImport?.source, failedSymbols: data.marketDataImport?.symbolsFailed || [] },
  cycles: report.cycles.sort((a, b) => b.closeAt.localeCompare(a.closeAt)).map((cycle) => ({ symbol: cycle.symbol, currency: cycle.currency, openAt: cycle.openAt, closeAt: cycle.closeAt, holdingDays: cycle.holdingDays, pnl: round(cycle.pnl), returnPct: round(cycle.returnPct * 100), maePct: cycle.maePct == null ? null : round(cycle.maePct * 100), mfePct: cycle.mfePct == null ? null : round(cycle.mfePct * 100), barCount: cycle.barCount })),
  realizedPnlByCurrency: Object.fromEntries(Object.entries(report.realizedPnlByCurrency).map(([key, value]) => [key, round(value)])),
  positions: report.positions.sort((a, b) => a.symbol.localeCompare(b.symbol)).map((position) => ({ ...position, averageCost: round(position.averageCost) })),
  validation: { schemaIssues: validateDataset(data), engineIssues: report.issues.filter((issue) => issue.level === "error"), cashActivitiesRequiringReview: data.cashActivities.filter((activity) => activity.requiresReview) },
};
console.log(JSON.stringify(output, null, 2));
