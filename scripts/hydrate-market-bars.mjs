import { readFile, writeFile } from "node:fs/promises";
import { toProviderSymbol } from "../lib/quote-engine.mjs";
import { summarize } from "../lib/trade-engine.mjs";

const [datasetPath] = process.argv.slice(2);
if (!datasetPath) throw new Error("需要JSON資料路徑");
const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const targets = [...new Map(dataset.fills.map((fill) => [`${fill.market}:${fill.symbol}`, { symbol: fill.symbol, market: fill.market }])).values()];
const start = Math.floor(new Date("2026-08-03T00:00:00Z").getTime() / 1000);
const end = Math.floor(new Date("2026-08-22T00:00:00Z").getTime() / 1000);
const marketBars = []; const errors = [];

for (let offset = 0; offset < targets.length; offset += 5) {
  const batch = targets.slice(offset, offset + 5);
  const results = await Promise.all(batch.map(async ({ symbol, market }) => {
    const providerSymbol = toProviderSymbol(symbol, market);
    try {
      const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(providerSymbol)}?period1=${start}&period2=${end}&interval=1d&events=history`, { headers: { "User-Agent": "TradeReviewPhase0/0.1" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json(); const result = payload?.chart?.result?.[0]; const quote = result?.indicators?.quote?.[0];
      if (!result?.timestamp?.length || !quote) throw new Error("沒有日線資料");
      return result.timestamp.flatMap((time, index) => {
        const values = [quote.open?.[index], quote.high?.[index], quote.low?.[index], quote.close?.[index]];
        if (values.some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0)) return [];
        return [{ symbol, market, date: new Date(time * 1000).toISOString().slice(0, 10), open: Number(values[0]), high: Number(values[1]), low: Number(values[2]), close: Number(values[3]), volume: Number(quote.volume?.[index] || 0), source: "Yahoo Finance via MarketDataAdapter", providerSymbol, fetchedAt: new Date().toISOString() }];
      });
    } catch (error) { errors.push({ symbol, market, providerSymbol, message: error instanceof Error ? error.message : "行情讀取失敗" }); return []; }
  }));
  marketBars.push(...results.flat());
}

dataset.marketBars = marketBars;
dataset.marketDataImport = { fetchedAt: new Date().toISOString(), range: ["2026-08-03", "2026-08-21"], source: "Yahoo Finance via MarketDataAdapter", symbolsRequested: targets.length, symbolsFailed: errors };
await writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
const report = summarize(dataset);
console.log(JSON.stringify({ requestedSymbols: targets.length, bars: marketBars.length, errors, cycles: report.cycles.length, cyclesWithBars: report.cycles.filter((cycle) => cycle.barCount > 0).length, qualityPct: report.qualityPct, unresolved: report.issues }, null, 2));
