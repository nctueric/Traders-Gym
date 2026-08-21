export const QUOTE_REFRESH_MS = 30_000;
export const FX_STALE_MS = 120_000;
export const USDTWD_SYMBOL = "USDTWD=X";

export function twdToUsd(value, usdTwdRate) {
  const amount = Number(value);
  const rate = Number(usdTwdRate);
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return null;
  return amount / rate;
}

export function pnlToUsd(values = {}, usdTwdRate) {
  const usd = Number(values.USD || 0);
  const twd = Number(values.TWD || 0);
  const convertedTwd = twdToUsd(twd, usdTwdRate);
  if (twd !== 0 && convertedTwd == null) return null;
  return usd + (convertedTwd || 0);
}

export function isQuoteStale(updatedAt, now = Date.now(), staleAfterMs = FX_STALE_MS) {
  const timestamp = new Date(updatedAt).getTime();
  return !Number.isFinite(timestamp) || now - timestamp > staleAfterMs;
}

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
