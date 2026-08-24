import { normalizeYahooHistory } from "@/lib/quote-engine.mjs";

const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,20}$/;

export async function GET(request: Request) {
  const symbol = (new URL(request.url).searchParams.get("symbol") || "").trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) return Response.json({ error: "ETF 代號格式無效" }, { status: 400 });
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&events=history`, { headers: { "User-Agent": "TradeReviewPhase1/0.3" }, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bars = normalizeYahooHistory(symbol, await response.json());
    return Response.json({ symbol, bars, source: "Yahoo Finance via MarketDataAdapter", fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "歷史行情讀取失敗" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
