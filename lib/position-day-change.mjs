// Price movement of the current holding, not account-level intraday realized P&L.
export function positionDayChange(position, quote) {
  const price = quote?.price, previous = quote?.previousClose, quantity = position?.quantity;
  if (![price, previous, quantity].every(v => typeof v === 'number' && Number.isFinite(v)) || price <= 0 || previous <= 0 || quantity <= 0 || !['LONG', 'SHORT'].includes(position?.direction)) return { amount: null, rate: null };
  const direction = position.direction === 'SHORT' ? -1 : 1;
  const rate = (price / previous - 1) * direction;
  const amount = (price - previous) * quantity * direction;
  return Number.isFinite(amount) && Number.isFinite(rate) ? { amount, rate } : { amount: null, rate: null };
}
