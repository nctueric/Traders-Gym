import { currencyTotal } from './valuation.mjs';
import { isQuoteStale } from './quote-engine.mjs';
export function homeAmounts(home, currency, now = Date.now()) {
    const fx = home.fxQuote && !isQuoteStale(home.fxQuote.updatedAt, now) ? home.fxQuote.price : null;
    const unrealized = home.missingQuotes || !home.unrealizedByCurrency ? null : currencyTotal(home.unrealizedByCurrency, currency, fx);
    const realized = home.realized[currency];
    const bad = home.missingQuotes || home.cashNeedsReview;
    return { total: bad ? null : currencyTotal(home.assetByCurrency, currency, fx), cash: home.cashNeedsReview ? null : currencyTotal(home.cashByCurrency, currency, fx), gross: home.missingQuotes ? null : currencyTotal(home.grossByCurrency, currency, fx), realized, unrealized, profit: realized == null || unrealized == null ? null : realized + unrealized, fx, fxStale: Boolean(home.fxQuote && fx == null) };
}
