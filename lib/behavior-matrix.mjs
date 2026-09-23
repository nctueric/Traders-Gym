// Derived chart data only; never persisted back to the ledger.
export function matrixNumber(value) {
  if (value == null || !["number", "string"].includes(typeof value) || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export const MATRIX_LEGENDS = [
    { key: "PROFIT", label: "獲利", tone: "gain", shape: "circle" },
    { key: "LOSS", label: "虧損", tone: "loss", shape: "triangle" },
    { key: "FLAT", label: "損益為零", tone: "neutral", shape: "diamond" },
];

export function buildBehaviorMatrices(cycles = []) {
  const result = { mfeReturn: [], maeReturn: [], mfeReturnExcluded: [], maeReturnExcluded: [] };
  for (const cycle of cycles) {
    const mfePct = matrixNumber(cycle.mfePct);
    const maePct = matrixNumber(cycle.maePct);
    const returnPct = matrixNumber(cycle.returnPct);
    const ratio = mfePct != null && mfePct > 0 && returnPct != null ? returnPct / mfePct : null;
    const retention = matrixNumber(ratio);
    const base = { cycleId: cycle.id, symbol: cycle.symbol, direction: cycle.direction, openAt: cycle.openAt, closeAt: cycle.closeAt, mfePct, maePct, returnPct, retention, category: returnPct == null ? "NO_DATA" : returnPct > 0 ? "PROFIT" : returnPct < 0 ? "LOSS" : "FLAT" };
    const mfeReasons = [
      ...(mfePct == null ? ["缺少有效 MFE 行情"] : []),
      ...(returnPct == null ? ["缺少有效交易損益率"] : []),
    ];
    if (mfeReasons.length) result.mfeReturnExcluded.push({ ...base, reason: mfeReasons.join("；") });
    else result.mfeReturn.push(base);
    const maeReasons = [...(maePct == null ? ["缺少有效 MAE 行情"] : []), ...(returnPct == null ? ["缺少有效交易損益率"] : [])];
    if (maeReasons.length) result.maeReturnExcluded.push({ ...base, reason: maeReasons.join("；") });
    else result.maeReturn.push(base);
  }
  return result;
}

export function matrixPercent(value, digits = 1) {
  if (matrixNumber(value) == null) return "—";
  const percentage = value * 100;
  if (percentage !== 0 && Math.abs(percentage) < 10 ** -digits) {
    return new Intl.NumberFormat("zh-TW", { maximumSignificantDigits: 3 }).format(percentage) + "%";
  }
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: digits }).format(Object.is(percentage, -0) ? 0 : percentage) + "%";
}

export function matrixTicks(domain, count = 6) {
  const [min, max] = domain;
  const raw = (max - min) / Math.max(2, count - 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const candidates = [0.1, 1, 10].flatMap(scale => [1, 2, 2.5, 5, 10].map(unit => unit * power * scale));
  const ranked = candidates.map(step => ({ step, count: Math.floor(max / step + 1e-9) - Math.ceil(min / step - 1e-9) + 1 }))
    .filter(item => item.count > 0 && item.count <= count)
    .sort((a, b) => b.count - a.count || Math.abs(a.step - raw) - Math.abs(b.step - raw));
  const step = ranked[0]?.step || raw;
  if (!(step > 0) || !Number.isFinite(step)) return [];
  const ticks = [];
  const start = Math.ceil(min / step - 1e-9);
  const end = Math.floor(max / step + 1e-9);
  for (let i = start; i <= end && ticks.length < 30; i++) ticks.push(Number((i * step).toPrecision(12)));
  return ticks;
}

function matrixExtent(values) {
    const min = Math.min(...values), max = Math.max(...values);
    const pad = Math.max(max - min, 0.01) * 0.06;
    return [min - pad, max + pad];
}

export function matrixSharedY(data) {
  return matrixExtent([0, ...data.mfeReturn.map(p => p.returnPct), ...data.maeReturn.map(p => p.returnPct)].filter(v => matrixNumber(v) != null));
}

/** @param {number[] | null} [sharedY] */
export function matrixDomains(points, kind, sharedY = null) {
  const xs = [0, ...(kind === "maeReturn" ? [-0.1] : []), ...points.map(p => kind === "mfeReturn" ? p.mfePct : p.maePct)].filter(v => matrixNumber(v) != null);
  const ys = [0, ...points.map(p => p.returnPct)].filter(v => matrixNumber(v) != null);
  return { x: matrixExtent(xs), y: sharedY || matrixExtent(ys) };
}

// One transform serves dots, ticks, reference lines, hit testing and zoom.
export function matrixGeometry(domains, width, height, left = 64) {
  const rect = { left, right: width - 56, top: 38, bottom: height - 54 };
  const x = value => rect.left + (value - domains.x[0]) / (domains.x[1] - domains.x[0]) * (rect.right - rect.left);
  const y = value => rect.bottom - (value - domains.y[0]) / (domains.y[1] - domains.y[0]) * (rect.bottom - rect.top);
  return {
    ...rect, x, y,
    valueX: pixel => domains.x[0] + (pixel - rect.left) / (rect.right - rect.left) * (domains.x[1] - domains.x[0]),
    valueY: pixel => domains.y[0] + (rect.bottom - pixel) / (rect.bottom - rect.top) * (domains.y[1] - domains.y[0]),
    contains: (px, py) => px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom,
  };
}

export function matrixCoordinates(point, kind) {
  return { x: kind === "mfeReturn" ? point.mfePct : point.maePct, y: point.returnPct };
}

// Return data-space endpoints clipped to the actual viewport, never a screen diagonal.
export function matrixEqualitySegment(domains, inverse = false) {
  const slope = inverse ? -1 : 1;
  const min = Math.max(domains.x[0], inverse ? -domains.y[1] : domains.y[0]);
  const max = Math.min(domains.x[1], inverse ? -domains.y[0] : domains.y[1], inverse ? 0 : Infinity);
  if (!(max > min)) return null;
  return { start: { x: min, y: slope * min }, end: { x: max, y: slope * max } };
}

export function matrixDifference(point, kind) {
  const { x, y } = matrixCoordinates(point, kind);
  if (matrixNumber(x) == null || matrixNumber(y) == null) return null;
  return matrixNumber(kind === "mfeReturn" ? x - y : y - x);
}

export function matrixAmplitudeRatio(point) {
  const mae = matrixNumber(point.maePct), realized = matrixNumber(point.returnPct);
  return mae != null && mae < 0 && realized != null && realized > 0 ? matrixNumber(realized / -mae) : null;
}

export function matrixPercentagePoints(value, signed = true) {
  if (matrixNumber(value) == null) return "—";
  const label = matrixPercent(value, 2).replace("%", "");
  return (signed && value > 0 ? "+" : "") + label + " 個百分點";
}

export function matrixVisible(point, kind, domains) {
  const { x, y } = matrixCoordinates(point, kind);
  return x >= domains.x[0] && x <= domains.x[1] && y >= domains.y[0] && y <= domains.y[1];
}

export function nearbyMatrixPoints(points, kind, geometry, pixel, radius = 18) {
  return points.map(point => {
    const value = matrixCoordinates(point, kind);
    return { point, distance: Math.hypot(geometry.x(value.x) - pixel.x, geometry.y(value.y) - pixel.y) };
  }).filter(item => item.distance <= radius).sort((a, b) => a.distance - b.distance || String(a.point.cycleId).localeCompare(String(b.point.cycleId))).map(item => item.point);
}

export function matrixBoxZoom(geometry, start, end) {
  if (Math.abs(start.x - end.x) < 8 || Math.abs(start.y - end.y) < 8) return null;
  const clampX = value => Math.min(geometry.right, Math.max(geometry.left, value));
  const clampY = value => Math.min(geometry.bottom, Math.max(geometry.top, value));
  const xs = [geometry.valueX(clampX(start.x)), geometry.valueX(clampX(end.x))].sort((a, b) => a - b);
  const ys = [geometry.valueY(clampY(start.y)), geometry.valueY(clampY(end.y))].sort((a, b) => a - b);
  return xs[1] > xs[0] && ys[1] > ys[0] ? { x: xs, y: ys } : null;
}

export function zoomMatrix(domains, full, factor, center) {
  const scale = (key) => {
    const [min, max] = domains[key], [fullMin, fullMax] = full[key];
    const span = Math.min(fullMax - fullMin, Math.max((fullMax - fullMin) / 1e6, (max - min) * factor));
    const pivot = Math.min(max, Math.max(min, center?.[key] ?? (min + max) / 2));
    const proposed = pivot - (pivot - min) / (max - min) * span;
    const start = Math.max(fullMin, Math.min(fullMax - span, proposed));
    return [start, start + span];
  };
  return { x: scale("x"), y: scale("y") };
}

// Keep guide labels readable even when extreme values compress their spacing.
export function matrixReferenceLabels(values, geometry) {
  const items = values.map(value => ({ value, y: geometry.y(value), labelY: geometry.y(value) }))
    .filter(item => item.y >= geometry.top && item.y <= geometry.bottom)
    .sort((a, b) => a.y - b.y);
  for (let index = 0; index < items.length; index++) {
    items[index].labelY = Math.max(geometry.top + 6, items[index].y, index ? items[index - 1].labelY + 15 : -Infinity);
  }
  for (let index = items.length - 1; index >= 0; index--) {
    items[index].labelY = Math.min(geometry.bottom - 4, items[index].labelY, index < items.length - 1 ? items[index + 1].labelY - 15 : Infinity);
  }
  return items;
}
