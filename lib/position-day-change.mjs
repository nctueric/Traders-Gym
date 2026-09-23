// Intraday change of remaining FIFO holdings, excluding fees and closed shares.
const missing = () => ({ amount: null, rate: null });
function marketDay(timestamp, timeZone) {
  if (typeof timestamp !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return timestamp;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : null;
}
export function positionDayChange(position, quote) {
  const price = quote?.price, previous = quote?.previousClose, quantity = position?.quantity;
  if (![price, quantity].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0) || !['LONG', 'SHORT'].includes(position?.direction)) return missing();
  const timeZone = position.currency === 'TWD' || ['TWSE','TSE','TAIWAN','TPEX','OTC'].includes(position.market) ? 'Asia/Taipei' : 'America/New_York';
  const day = marketDay(quote.updatedAt, timeZone);
  if (!day || !Array.isArray(position.fills) || !position.fills.length) return missing();
  const lots = [];
  const openingSide = position.direction === 'LONG' ? 'BUY' : 'SELL';
  for (const fill of [...position.fills].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp))) {
    const fillDay = marketDay(fill.timestamp, timeZone);
    let qty = Number(fill.quantity);
    if (!fillDay || fillDay > day || (fill.timestamp.length > 10 && new Date(fill.timestamp) > new Date(quote.updatedAt)) || !Number.isFinite(qty) || qty <= 0 || !['BUY','SELL'].includes(fill.side)) return missing();
    if (fill.side === openingSide) {
      const basis = fillDay === day ? Number(fill.price) : previous;
      lots.push({ quantity: qty, basis });
    } else {
      while (qty > 1e-9 && lots.length) {
        const used = Math.min(qty, lots[0].quantity);
        qty -= used; lots[0].quantity -= used;
        if (lots[0].quantity <= 1e-9) lots.shift();
      }
      if (qty > 1e-9) return missing();
    }
  }
  const remaining = lots.reduce((sum,lot) => sum + lot.quantity, 0);
  if (Math.abs(remaining - quantity) > 1e-7 * Math.max(1,quantity)) return missing();
  if (lots.some(lot => typeof lot.basis !== 'number' || !Number.isFinite(lot.basis) || lot.basis <= 0)) return missing();
  const basis = lots.reduce((sum,lot) => sum + lot.quantity * lot.basis, 0);
  const amount = (price * quantity - basis) * (position.direction === 'SHORT' ? -1 : 1);
  return basis > 0 && Number.isFinite(amount) ? { amount, rate: amount / basis } : missing();
}
