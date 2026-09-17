import { toProviderSymbol, USDTWD_SYMBOL } from './quote-engine.mjs';

const cashSigns = { DEPOSIT: 1, WITHDRAWAL: -1, DIVIDEND: 1, INTEREST: 1, FEE: -1, TAX: -1 };
const day = value => String(value || '').slice(0, 10);
const recordDay = item => item.tradeDate || day(item.timestamp);
const supported = currency => ['USD', 'TWD'].includes(currency);
const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
const keyFor = (account, currency) => JSON.stringify([account, currency]);

export function lastInvestmentDate(cycle) {
  const side = cycle.direction === 'SHORT' ? 'SELL' : 'BUY';
  return (cycle.fills || []).filter(fill => fill.side === side && fill.splitRole !== 'CLOSE').map(recordDay).filter(validDay).sort().at(-1) || null;
}

function barIndex(bars) {
  const index = new Map();
  for (const bar of bars) {
    if (!validDay(bar.date) || !(Number(bar.close) > 0)) continue;
    const symbol = bar.providerSymbol || toProviderSymbol(bar.symbol, bar.market || bar.exchange);
    if (!index.has(symbol)) index.set(symbol, new Map());
    index.get(symbol).set(bar.date, bar);
  }
  return new Map([...index].map(([symbol, dates]) => [symbol, [...dates.values()].sort((a, b) => a.date.localeCompare(b.date))]));
}
function latestBar(index, symbol, date) {
  return index.get(symbol)?.findLast(bar => bar.date <= date) || null;
}
function holdingsAt(data, date) {
  const holdings = new Map();
  for (const fill of data.fills || []) {
    if (!validDay(recordDay(fill)) || recordDay(fill) > date) continue;
    const currency = fill.currency || 'USD';
    const provider = toProviderSymbol(fill.symbol, fill.market || fill.exchange);
    const key = JSON.stringify([fill.accountId || 'default', provider, currency]);
    const holding = holdings.get(key) || { symbol: fill.symbol, providerSymbol: provider, currency, quantity: 0 };
    holding.quantity += (fill.side === 'BUY' ? 1 : -1) * Number(fill.quantity);
    holdings.set(key, holding);
  }
  return [...holdings.values()].filter(item => Math.abs(item.quantity) > 1e-9);
}

// A cash opening is a replacement cash balance at its effective timestamp, not an extra deposit.
// Holdings still include all earlier fills; an opening in one account never resets another account.
function nativeEquityAt(data, date, index) {
  const problems = [], warnings = [], groups = new Map();
  const accounts = new Set([...(data.accounts || []).map(a => a.id), ...(data.fills || []).map(f => f.accountId).filter(Boolean)]);
  function group(accountId, currency) {
    const key = keyFor(accountId, currency);
    if (!groups.has(key)) groups.set(key, { accountId, currency, fills: [], activities: [] });
    return groups.get(key);
  }
  for (const fill of data.fills || []) {
    if (!validDay(recordDay(fill))) { problems.push('成交日期無效'); continue; }
    if (recordDay(fill) > date) continue;
    const currency = fill.currency || 'USD';
    if (!supported(currency)) problems.push(`不支援幣別 ${currency}`);
    if (!(Number(fill.quantity) > 0) || !(Number(fill.price) > 0) || !['BUY', 'SELL'].includes(fill.side) || !Number.isFinite(Number(fill.fee || 0)) || Number(fill.fee || 0) < 0) problems.push('成交數值無效');
    group(fill.accountId || 'default', currency).fills.push(fill);
    if (fill.feeKnown === false) warnings.push('未含未填手續費');
  }
  for (const activity of data.cashActivities || []) {
    if (!validDay(day(activity.timestamp))) { problems.push('資金活動日期無效'); continue; }
    if (day(activity.timestamp) > date) continue;
    let accountId = activity.accountId;
    if (!accountId && accounts.size === 1) accountId = [...accounts][0];
    if (!accountId && accounts.size === 0) accountId = 'default';
    if (!accountId || activity.requiresReview || !supported(activity.currency) || !Number.isFinite(Number(activity.amount))) { problems.push('資金活動有未確認帳戶、幣別或金額'); continue; }
    group(accountId, activity.currency).activities.push(activity);
  }
  const assets = {};
  for (const g of groups.values()) {
    const ordered = [...g.activities].sort((a,b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const opening = ordered.findLast(a => a.type === 'OPENING_BALANCE');
    const cutoff = opening?.timestamp;
    const after = item => !cutoff || new Date(item.timestamp).getTime() >= new Date(cutoff).getTime();
    let cash = opening ? Number(opening.amount) : 0;
    const firstDeposit = ordered.find(a => a.type === 'DEPOSIT');
    const earliestFill = [...g.fills].sort((a,b) => String(a.timestamp).localeCompare(String(b.timestamp)))[0];
    if (!opening && (!firstDeposit || earliestFill && new Date(firstDeposit.timestamp) > new Date(earliestFill.timestamp))) problems.push(`${g.accountId} ${g.currency} 缺期初資金資料`);
    if (opening && ordered.filter(a => a.type === 'OPENING_BALANCE' && a.timestamp === cutoff).length > 1) problems.push(`${g.accountId} 期初餘額時間重複`);
    for (const a of ordered.filter(after)) {
      if (a.type === 'OPENING_BALANCE') continue;
      if (!(a.type in cashSigns)) { problems.push(`未支援的資金活動 ${a.type}`); continue; }
      cash += cashSigns[a.type] * Number(a.amount);
    }
    for (const f of g.fills.filter(after)) cash += (f.side === 'BUY' ? -1 : 1) * Number(f.quantity) * Number(f.price) - Number(f.fee || 0);
    assets[g.currency] = (assets[g.currency] || 0) + cash;
  }
  const prices = [];
  for (const holding of holdingsAt(data, date)) {
    const bar = latestBar(index, holding.providerSymbol, date);
    // Bare symbols are legacy dataset keys. Only use them if the ledger has one venue for that symbol.
    const variants = new Set((data.fills || []).filter(f => f.symbol === holding.symbol).map(f => toProviderSymbol(f.symbol, f.market || f.exchange)));
    const priceBar = bar || (variants.size === 1 ? latestBar(index, holding.symbol, date) : null);
    if (!priceBar) { problems.push(`缺 ${holding.providerSymbol} 持倉收盤價`); continue; }
    if (!prices.some(p => p.symbol === holding.providerSymbol)) prices.push({ symbol: holding.providerSymbol, date: priceBar.date, close: Number(priceBar.close) });
    assets[holding.currency] = (assets[holding.currency] || 0) + holding.quantity * Number(priceBar.close);
    if (priceBar.date < date) warnings.push(`${holding.providerSymbol} 採 ${priceBar.date} 收盤`);
  }
  return { date, assets, prices, problems: [...new Set(problems)], warnings: [...new Set(warnings)] };
}

export function historicalEquityAt(data, date, currency = 'USD', additionalBars = []) {
  return equityFromIndex(data, date, currency, barIndex([...(data.marketBars || []), ...additionalBars]));
}
function equityFromIndex(data, date, currency, index, nativeCache = new Map()) {
  if (!validDay(date)) return { date, currency, total: null, problems: ['缺最後投入日期'], warnings: [], prices: [], fx: null };
  if (!nativeCache.has(date)) nativeCache.set(date, nativeEquityAt(data, date, index));
  const native = nativeCache.get(date);
  const problems = [...native.problems];
  if (!supported(currency)) problems.push(`不支援幣別 ${currency}`);
  const other = currency === 'USD' ? 'TWD' : 'USD';
  const fxBar = latestBar(index, USDTWD_SYMBOL, date);
  const needsFx = Math.abs(native.assets[other] || 0) > 1e-9;
  if (needsFx && !fxBar) problems.push('缺歷史 USDTWD 匯率');
  let total = Number(native.assets[currency] || 0);
  if (needsFx && fxBar) total += currency === 'USD' ? native.assets.TWD / Number(fxBar.close) : native.assets.USD * Number(fxBar.close);
  if (!(total > 0) || !Number.isFinite(total)) problems.push('帳本總資產不大於零或無效');
  return { ...native, currency, total: problems.length ? null : total, problems, fx: needsFx && fxBar ? { date: fxBar.date, rate: Number(fxBar.close) } : null };
}

export function buildReviewLedgerMetrics(data, visibleCycles, lossSampleCycles, additionalBars = []) {
  const losses = lossSampleCycles.filter(c => Number(c.pnl) < 0 && Number(c.entryNotional) > 0 && Number.isFinite(Number(c.entryNotional)) && Number.isFinite(Number(c.pnl))).map(c => Number(c.pnl) / Number(c.entryNotional));
  const averageLoss = losses.length ? Math.abs(losses.reduce((s,v) => s+v, 0) / losses.length) : null;
  const index = barIndex([...(data.marketBars || []), ...additionalBars]), cache = new Map();
  const rows = Object.fromEntries(visibleCycles.map(c => {
    const invested = Number(c.entryNotional), pnl = Number(c.pnl);
    const returnPct = invested > 0 && Number.isFinite(invested) && Number.isFinite(pnl) ? pnl / invested : null;
    const date = lastInvestmentDate(c);
    const equity = equityFromIndex(data, date, c.currency || 'USD', index, cache);
    return [c.id, { invested, pnl, currency: c.currency || 'USD', returnPct, equity, allocation: invested > 0 && Number.isFinite(invested) && equity.total != null ? invested / equity.total : null, expectancy: averageLoss > 0 && returnPct != null ? returnPct / averageLoss : null }];
  }));
  return { rows, averageLoss, lossCount: losses.length };
}

// One bounded request per provider symbol; returned bars are kept in memory, never appended to trades.
export function reviewHistoryRequests(data, cycles) {
  const targets = new Map();
  function add(symbol, date) {
    if (!symbol || !validDay(date)) return;
    const prior = targets.get(symbol);
    targets.set(symbol, { symbol, start: !prior || date < prior.start ? date : prior.start, end: !prior || date > prior.end ? date : prior.end });
  }
  for (const date of new Set(cycles.map(lastInvestmentDate).filter(Boolean))) {
    for (const holding of holdingsAt(data, date)) add(holding.providerSymbol, date);
    const currencies = new Set([...(data.fills || []), ...(data.cashActivities || [])].filter(r => recordDay(r) <= date).map(r => r.currency || 'USD'));
    if (currencies.size > 1) add(USDTWD_SYMBOL, date);
  }
  return [...targets.values()].map(t => ({ ...t, start: new Date(Date.parse(t.start) - 40 * 86400000).toISOString().slice(0,10) })).sort((a,b) => a.symbol.localeCompare(b.symbol));
}
