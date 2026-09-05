import { normalizeYahooChart } from "@/lib/quote-engine.mjs";
import { rejectAnonymous } from "@/app/account-server";

const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

async function fetchYahooQuote(symbol: string) {
  let lastError = "報價讀取失敗";
  for (const host of YAHOO_HOSTS) {
    try {
      const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`, {
        headers: { "User-Agent": "Mozilla/5.0 TradeReviewPhase1/0.5", Accept: "application/json" },
        cf: { cacheEverything: true, cacheTtl: 15 },
      } as RequestInit);
      if (!response.ok) { lastError = `HTTP ${response.status}`; continue; }
      return normalizeYahooChart(symbol, await response.json());
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(lastError);
}

export async function GET(request: Request) {
  const denied = await rejectAnonymous(request); if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const symbols = [...new Set((searchParams.get("symbols") || "").split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, 50);
  if (!symbols.length) return Response.json({ quotes: [], errors: [], fetchedAt: new Date().toISOString() });
  const rows: ({ quote: ReturnType<typeof normalizeYahooChart> } | { error: { symbol: string; message: string } })[] = [];
  for (const symbol of symbols) {
    try {
      rows.push({ quote: await fetchYahooQuote(symbol) });
    } catch (error) {
      rows.push({ error: { symbol, message: error instanceof Error ? error.message : "報價讀取失敗" } });
    }
  }
  return Response.json({ quotes: rows.flatMap((row) => "quote" in row ? [row.quote] : []), errors: rows.flatMap((row) => "error" in row ? [row.error] : []), fetchedAt: new Date().toISOString(), refreshAfterSeconds: 30 }, { headers: { "Cache-Control": "public, max-age=10, s-maxage=15, stale-while-revalidate=60" } });
}
