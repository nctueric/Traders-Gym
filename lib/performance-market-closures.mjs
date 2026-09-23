// Verified extended Taiwan equity-market closures, not inferred from missing bars.
// Keep the last session exact: a missing pre-holiday session must not be waived.
// Unknown years/markets retain the normal seven-calendar-day stale-price rule.
export const TAIWAN_EXTENDED_CLOSURES = [
  {lastSession:'2024-02-05',reopens:'2024-02-15',source:'https://stock.concords.com.tw/WebSiteUpload/News/113年有價證券集中交易市場開（休）市日期表.pdf'},
  {lastSession:'2025-01-22',reopens:'2025-02-03',source:'https://eshop.twse.com.tw/zh/news/detail/8a82e9e69471d3e8019495d573f70017'},
  {lastSession:'2026-02-11',reopens:'2026-02-23',source:'https://eshop.twse.com.tw/zh/news/detail/8a82e9e69c3aecea019c513b97850026'},
];
function closureAt(symbol,date) {
  if (!/\.(TW|TWO)$/.test(symbol)) return null;
  return TAIWAN_EXTENDED_CLOSURES.find(c=>date>c.lastSession&&date<c.reopens)||null;
}
export function isVerifiedClosureQuote(symbol,quoteDate,date) {
  return closureAt(symbol,date)?.lastSession===quoteDate;
}
export function performanceHistoryLookback(symbol,start) {
  const normal=new Date(Date.parse(start)-7*86400000).toISOString().slice(0,10);
  const closure=closureAt(symbol,start);
  return closure&&closure.lastSession<normal?closure.lastSession:normal;
}
