export const EMA_PERIODS = [10, 21, 50];
export function emaWarmupStart(date) {
  const value = new Date(`${date}T00:00:00Z`);
  const month = value.getUTCMonth();
  value.setUTCFullYear(value.getUTCFullYear() - 1);
  if (value.getUTCMonth() !== month) value.setUTCDate(0);
  return value.toISOString().slice(0, 10);
}
// Input must be chronological, one valid close per trading date.
export function withEma(candles) {
  const sums = {}, previous = {};
  return candles.map((candle, index) => {
    const ema = {};
    for (const period of EMA_PERIODS) {
      sums[period] = (sums[period] || 0) + candle.close;
      if (index < period - 1) ema[period] = null;
      else if (index === period - 1) ema[period] = previous[period] = sums[period] / period;
      else ema[period] = previous[period] = candle.close * (2 / (period + 1)) + previous[period] * (1 - 2 / (period + 1));
    }
    return { ...candle, ema };
  });
}
export function inspectChartPoint(g, count, x, y) {
  if (!g || !count || x < g.left || x > g.right || y < g.top || y > g.volumeBottom) return null;
  const index = Math.max(0, Math.min(count - 1, Math.floor((x - g.left) / g.step)));
  return { index, x: g.left + g.step * (index + 0.5), y,
    price: y <= g.priceBottom ? g.high - (y - g.top) / (g.priceBottom - g.top) * (g.high - g.low) : null };
}
