import { normalizeYahooHistory, normalizeYahooOhlcHistory } from "@/lib/quote-engine.mjs";

const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,20}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

async function fetchYahooHistory(symbol: string, range: URLSearchParams) {
  let lastError = "歷史行情讀取失敗";
  for (const host of YAHOO_HOSTS) {
    try {
      const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${range}`, {
        headers: { "User-Agent": "Mozilla/5.0 TradeReviewPhase1/0.5", Accept: "application/json" },
        cf: { cacheEverything: true, cacheTtl: 1800 },
      } as RequestInit);
      if (!response.ok) { lastError = `HTTP ${response.status}`; continue; }
      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(lastError);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
  const datasetSymbol = (searchParams.get("datasetSymbol") || symbol).trim().toUpperCase();
  const mode = searchParams.get("mode") === "ohlc" ? "ohlc" : "close";
  const start = searchParams.get("start") || "";
  const end = searchParams.get("end") || "";
  if (!SYMBOL_PATTERN.test(symbol)) return Response.json({ error: "ETF 代號格式無效" }, { status: 400 });
  if (!SYMBOL_PATTERN.test(datasetSymbol)) return Response.json({ error: "資料集代號格式無效" }, { status: 400 });
  if ((start && !DATE_PATTERN.test(start)) || (end && !DATE_PATTERN.test(end))) return Response.json({ error: "歷史行情日期格式無效" }, { status: 400 });
  try {
    const range = new URLSearchParams({ interval: "1d", events: "history" });
    if (start && end) {
      const period1 = Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000);
      const requestedEnd = new Date(`${end}T00:00:00Z`).getTime();
      const latestEnd = Date.now();
      const period2 = Math.floor(Math.min(requestedEnd, latestEnd) / 1000) + 86_400;
      range.set("period1", String(period1));
      range.set("period2", String(period2));
    } else {
      range.set("range", "1y");
    }
    const payload = await fetchYahooHistory(symbol, range);
    const bars = mode === "ohlc" ? normalizeYahooOhlcHistory(datasetSymbol, payload) : normalizeYahooHistory(symbol, payload);
    return Response.json({ symbol: datasetSymbol, providerSymbol: symbol, bars, source: "Yahoo Finance via MarketDataAdapter", fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "歷史行情讀取失敗" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
