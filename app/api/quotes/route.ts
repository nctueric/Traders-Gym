import { normalizeYahooChart } from "@/lib/quote-engine.mjs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = [...new Set((searchParams.get("symbols") || "").split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, 20);
  if (!symbols.length) return Response.json({ quotes: [], errors: [], fetchedAt: new Date().toISOString() });
  const rows = await Promise.all(symbols.map(async (symbol) => {
    try {
      const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`, { headers: { "User-Agent": "TradeReviewPhase0/0.1" }, cf: { cacheTtl: 15 } } as RequestInit);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { quote: normalizeYahooChart(symbol, await response.json()) };
    } catch (error) { return { error: { symbol, message: error instanceof Error ? error.message : "報價讀取失敗" } }; }
  }));
  return Response.json({ quotes: rows.flatMap((row) => row.quote ? [row.quote] : []), errors: rows.flatMap((row) => row.error ? [row.error] : []), fetchedAt: new Date().toISOString(), refreshAfterSeconds: 30 }, { headers: { "Cache-Control": "no-store" } });
}
