const day = date => new Date(`${date}T00:00:00Z`).getTime();
const date = time => new Date(time).toISOString().slice(0,10);
const DAY = 86400000;
// Successful request intervals, including holidays, are saved alongside marketBars.
export function missingHistoryRanges(target, coverage = [], now = Date.now(), force = false) {
  const today = date(now), end = target.end < today ? target.end : today;
  if (target.start > end) return [];
  if (force) return [{start:target.start,end}];
  const intervals = coverage.filter(c => c.symbol === target.symbol && c.market === target.market && Number.isFinite(day(c.start)) && Number.isFinite(day(c.end)))
    .map(c => [day(c.start), Math.min(day(c.end), now-Date.parse(c.fetchedAt)<1800000 ? day(today) : day(today)-DAY)])
    .filter(([a,b])=>a<=b).sort((a,b)=>a[0]-b[0]);
  let cursor=day(target.start); const stop=day(end), missing=[];
  for(const [a,b] of intervals){if(b<cursor)continue;if(a>stop)break;if(a>cursor)missing.push({start:date(cursor),end:date(Math.min(stop,a-DAY))});cursor=Math.max(cursor,b+DAY);if(cursor>stop)break;}
  if(cursor<=stop)missing.push({start:date(cursor),end:date(stop)});
  return missing;
}
export function mergeHistoryCoverage(a = [], b = []) {
  return [...new Map([...a,...b].map(c=>[`${c.market}:${c.symbol}:${c.start}:${c.end}`,c])).values()];
}
