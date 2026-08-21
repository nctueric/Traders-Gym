export const QUOTE_REFRESH_MS = 30_000;

export function toProviderSymbol(symbol, market = "") {
  const clean = String(symbol || "").trim().toUpperCase();
  const venue = String(market || "").toUpperCase();
  if (!clean.includes(".") && ["TWSE", "TSE", "TAIWAN"].includes(venue)) return `${clean}.TW`;
  if (!clean.includes(".") && ["TPEX", "OTC"].includes(venue)) return `${clean}.TWO`;
  return clean;
}

export function normalizeYahooChart(symbol, payload) {
  const result = payload?.chart?.result?.[0];
  if (!result?.meta || !Number.isFinite(Number(result.meta.regularMarketPrice))) throw new Error(`${symbol} 無可用即時報價`);
  const price = Number(result.meta.regularMarketPrice);
  const previousClose = Number(result.meta.chartPreviousClose ?? result.meta.previousClose);
  return {
    symbol,
    price,
    previousClose: Number.isFinite(previousClose) ? previousClose : null,
    changePct: Number.isFinite(previousClose) && previousClose !== 0 ? price / previousClose - 1 : null,
    currency: result.meta.currency || "USD",
    marketState: result.meta.marketState || "UNKNOWN",
    exchange: result.meta.exchangeName || null,
    updatedAt: new Date(Number(result.meta.regularMarketTime || Date.now() / 1000) * 1000).toISOString(),
    source: "Yahoo Finance via MarketDataAdapter",
  };
}
