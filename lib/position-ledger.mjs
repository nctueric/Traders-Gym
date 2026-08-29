import { taipeiDate } from "./review-engine.mjs";

/** Read-only projection of this active cycle, never a second account ledger. */
export function buildPositionLedger(position) {
  const entrySide = position.direction === "SHORT" ? "SELL" : "BUY";
  let remaining = 0;
  const fills = [...(position.fills || [])].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const dates = fills.map((fill) => taipeiDate(fill.timestamp));
  const dateCounts = new Map();
  dates.forEach((date) => dateCounts.set(date, (dateCounts.get(date) || 0) + 1));
  const rows = fills.map((fill, index) => {
    const quantity = Number(fill.quantity);
    const beforeQuantity = remaining;
    const isEntry = fill.side === entrySide;
    remaining += isEntry ? quantity : -quantity;
    if (Math.abs(remaining) < 1e-9) remaining = 0;
    const type = isEntry ? (beforeQuantity === 0 ? "ENTRY" : "ADD") : remaining === 0 ? "EXIT" : "REDUCE";
    return {
      id: fill.id, eventId: `fill:${fill.id}`, timestamp: fill.timestamp, date: dates[index],
      sourceOrder: index, side: fill.side, type,
      action: isEntry ? (type === "ENTRY" ? "建倉" : "加碼") : position.direction === "SHORT" ? "回補" : "減碼",
      quantity, price: Number(fill.price), fee: Number(fill.fee || 0),
      notional: quantity * Number(fill.price), currency: fill.currency || position.currency,
      beforeQuantity, afterQuantity: remaining, note: fill.note || "",
      splitRole: fill.splitRole || null, originalFillId: fill.originalFillId || null,
      sameDay: dateCounts.get(dates[index]) > 1,
    };
  });
  return {
    rows: [...rows].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp) || a.sourceOrder - b.sourceOrder),
    fillCount: rows.length,
    entryCount: rows.filter((row) => row.type === "ENTRY" || row.type === "ADD").length,
    reductionCount: rows.filter((row) => row.type === "REDUCE" || row.type === "EXIT").length,
    quantity: remaining,
    quantityMatches: Math.abs(remaining - Number(position.quantity)) < 1e-8,
    hasSameDay: [...dateCounts.values()].some((count) => count > 1),
  };
}

/** Never substitute the next trading day when the selected fill has no candle. */
export function replayFocus(model, eventId) {
  const event = model.events.find((item) => item.id === eventId) || null;
  const index = event?.date ? model.candles.findIndex((candle) => candle.date === event.date) : -1;
  return { event, cursor: index >= 0 ? index : null, missingCandle: !!event?.date && index < 0 };
}
