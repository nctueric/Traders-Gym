import { summarize } from './trade-engine.mjs';
import { buildCurrentEquity } from './portfolio-engine.mjs';
import { restoreMarketSnapshot } from './trade-snapshot.mjs';
import { toProviderSymbol, USDTWD_SYMBOL } from './quote-engine.mjs';
import { cycleValue, convertCurrency } from './valuation.mjs';
import {validateTradeRecordPayload} from './trade-record-store.mjs';
import { sha256, authError } from './auth-core.mjs';
export const HOME_SCHEMA_VERSION = 1;
export function buildHomeView(dataset, now = new Date()) {
    const { quotes, lastQuoteAt } = restoreMarketSnapshot(dataset), report = summarize({ fills: dataset.fills, marketBars: dataset.marketBars });
    const equity = buildCurrentEquity(dataset, quotes, null, now), rawFx = quotes[USDTWD_SYMBOL], fxQuote = typeof rawFx?.price === 'number' && Number.isFinite(rawFx.price) && rawFx.price > 0 ? rawFx : null;
    const fxBars = (dataset.marketBars || []).filter(b => ['USDTWD', 'USDTWD=X'].includes(b.symbol));
    const positions = report.positions.map(p => { const q = quotes[toProviderSymbol(p.symbol, p.market)]; const price = typeof q?.price === 'number' && Number.isFinite(q.price) && q.price > 0 ? q.price : null; return { id: p.id, symbol: p.symbol, market: p.market, currency: p.currency, direction: p.direction, quantity: p.quantity, averageCost: p.averageCost, price, quoteAt: typeof q?.updatedAt === 'string' ? q.updatedAt : null, source: typeof q?.source === 'string' ? q.source.slice(0, 200) : null, marketValue: price == null ? null : price * p.quantity, unrealized: price == null ? null : (price - p.averageCost) * p.quantity * (p.direction === 'SHORT' ? -1 : 1) }; });
    const unrealizedByCurrency = positions.reduce((totals, p) => { if (p.unrealized != null)
        totals[p.currency] = (totals[p.currency] || 0) + p.unrealized; return totals; }, {});
    const realized = Object.fromEntries(['USD', 'TWD'].map(c => { const values = report.cycles.map(cycle => cycleValue(cycle, cycle.pnl, c, fxBars)); return [c, values.some(v => v == null) ? null : values.reduce((a, b) => a + b, 0)]; }));
    return { schemaVersion: HOME_SCHEMA_VERSION, asOf: now.toISOString(), lastQuoteAt, fxQuote: fxQuote ? { price: fxQuote.price, updatedAt: typeof fxQuote.updatedAt === 'string' ? fxQuote.updatedAt : null, source: typeof fxQuote.source === 'string' ? fxQuote.source.slice(0, 200) : null } : null, cashByCurrency: equity.cashByCurrency, assetByCurrency: equity.assetByCurrency, grossByCurrency: Object.fromEntries([...new Set([...Object.keys(equity.longValueByCurrency), ...Object.keys(equity.shortValueByCurrency)])].map(c => [c, (equity.longValueByCurrency[c] || 0) + (equity.shortValueByCurrency[c] || 0)])), realized, unrealizedByCurrency, missingQuotes: positions.some(p => p.price == null), cashNeedsReview: (dataset.cashActivities || []).some(r => !r.currency || r.requiresReview), positions: positions.sort((a, b) => (convertCurrency(b.marketValue, b.currency, 'USD', fxQuote?.price) || 0) - (convertCurrency(a.marketValue, a.currency, 'USD', fxQuote?.price) || 0) || a.symbol.localeCompare(b.symbol)).slice(0, 20), positionCount: positions.length, fillCount: dataset.fills.length, cycleCount: report.cycles.length, qualityPct: report.qualityPct, legacyColor: ['green-up', 'red-up'].includes(dataset.settings?.holdingsColorScheme) ? dataset.settings.holdingsColorScheme : null };
}
export { homeAmounts } from './home-amounts.mjs';
export function homeViewStatement(db, { ownerId, accountId, version, objectKey, sourceHash, home }) {
    const serialized = JSON.stringify(home);
    if (new TextEncoder().encode(serialized).length > 65536)
        throw authError('首頁摘要超過大小上限', 413);
    return db.prepare(`INSERT INTO ledger_home_views(account_id,owner_user_id,source_version,schema_version,source_hash,object_key,summary_json,created_at)
 SELECT account_id,owner_user_id,version,?,?,?,?,? FROM trade_account_snapshots WHERE account_id=? AND owner_user_id=? AND version=? AND COALESCE(object_key,'')=?
 ON CONFLICT(account_id) DO UPDATE SET owner_user_id=excluded.owner_user_id,source_version=excluded.source_version,schema_version=excluded.schema_version,source_hash=excluded.source_hash,object_key=excluded.object_key,summary_json=excluded.summary_json,created_at=excluded.created_at RETURNING account_id`).bind(HOME_SCHEMA_VERSION, sourceHash, objectKey || '', serialized, home.asOf, accountId, ownerId, version, objectKey || '');
}
export async function backfillHomeViews({ db, objects, limit = 20 }) {
    const rows = (await db.prepare(`SELECT s.* FROM trade_account_snapshots s LEFT JOIN ledger_home_views h ON h.account_id=s.account_id WHERE s.deleted_at IS NULL AND s.owner_user_id IS NOT NULL AND (h.source_version IS NULL OR h.owner_user_id<>s.owner_user_id OR h.source_version<>s.version OR h.schema_version<>? OR h.object_key<>COALESCE(s.object_key,'') OR length(h.source_hash)<>64 OR h.source_hash GLOB '*[^0-9a-f]*' OR NOT json_valid(h.summary_json)) LIMIT ?`).bind(HOME_SCHEMA_VERSION, limit).all()).results;
    let rebuilt = 0, changed = 0;
    for (const row of rows) {
        let text = row.dataset_json;
        if (row.object_key) {
            const object = await objects.get(row.object_key);
            if (!object)
                throw authError('回填來源快照不存在', 503);
            text = await object.text();
            if (object.customMetadata?.sha256 !== await sha256(text))
                throw authError('回填來源快照校驗失敗', 503);
        }
        const checked=validateTradeRecordPayload({accountId:row.account_id,accountName:row.account_name,baseVersion:row.version,dataset:JSON.parse(text)},{maxBytes:50_000_000});
        if(!checked.ok)throw authError(`回填來源帳本無效：${checked.error}`,503);
        const home = buildHomeView(checked.dataset);
        const result = await homeViewStatement(db, { ownerId: row.owner_user_id, accountId: row.account_id, version: row.version, objectKey: row.object_key, sourceHash: await sha256(text), home }).first();
        if (result)
            rebuilt++;
        else
            changed++;
    }
    return { examined: rows.length, rebuilt, changed };
}
