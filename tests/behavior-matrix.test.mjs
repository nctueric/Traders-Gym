import test from "node:test";
import assert from "node:assert/strict";
import { buildBehaviorMatrices, matrixAmplitudeRatio, matrixDifference, matrixEqualitySegment, matrixPercentagePoints, matrixSharedY, matrixReferenceLabels, matrixNumber, matrixPercent, matrixDomains, matrixTicks, matrixGeometry, matrixCoordinates, matrixVisible, matrixBoxZoom, nearbyMatrixPoints, zoomMatrix } from "../lib/behavior-matrix.mjs";
import { buildBehaviorDashboard } from "../lib/coach-engine.mjs";

const base = { id: "one", symbol: "AAA", direction: "LONG", openAt: "2026-01-02", closeAt: "2026-02-02", mfePct: 0.2, maePct: -0.1, returnPct: 0.08 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test("matrix data keeps actual zero distinct from missing, blank and invalid values", () => {
  for (const value of [null, undefined, "", "  ", false, true, NaN, Infinity, "abc"]) assert.equal(matrixNumber(value), null);
  assert.equal(matrixNumber(0), 0);
  assert.equal(matrixNumber("0"), 0);
  const data = buildBehaviorMatrices([
    base, { ...base, id: "missing", mfePct: null, maePct: null },
    { ...base, id: "zero", mfePct: 0, maePct: 0, returnPct: 0 },
    { ...base, id: "return", returnPct: null },
    { ...base, id: "bad-mae", maePct: Infinity },
  ]);
  assert.deepEqual(data.mfeReturn.map(p => p.cycleId), ["one", "zero", "bad-mae"]);
  assert.deepEqual(data.maeReturn.map(p => p.cycleId), ["one", "zero"]);
  assert.equal(data.mfeReturnExcluded.length, 2);
  assert.equal(data.mfeReturn.find(p => p.cycleId === "zero").retention, null);
  assert.equal(data.maeReturn.find(p => p.cycleId === "zero").category, "FLAT");
});

test("profit categories are identical in both charts while retention remains raw metadata", () => {
  const returns = [-0.04, 0, 0.099999, 0.1, 0.2, 0.3];
  const data = buildBehaviorMatrices(returns.map((returnPct, index) => ({ ...base, id: String(index), returnPct })));
  assert.deepEqual(data.mfeReturn.map(p => p.category), ["LOSS", "FLAT", "PROFIT", "PROFIT", "PROFIT", "PROFIT"]);
  near(data.mfeReturn[0].retention, -0.2);
  near(data.mfeReturn.at(-1).retention, 1.5);
  near(data.mfeReturn[3].retention, 0.5);
  assert.deepEqual(data.maeReturn.map(p => p.category), ["LOSS", "FLAT", "PROFIT", "PROFIT", "PROFIT", "PROFIT"]);
  assert.equal(data.mfeReturn[0].openAt, base.openAt);
});

test("dashboard uses strict chart validity without mutating trades or reviews", () => {
  const cycles = [{ ...base, fills: [], quantity: 1, averageEntry: 100, averageExit: 108 }, { ...base, id: "missing", mfePct: null, maePct: null }];
  const original = JSON.stringify(cycles);
  const result = buildBehaviorDashboard(cycles);
  assert.equal(result.mfeReturn.length, 1);
  assert.equal(result.maeReturn.length, 1);
  assert.equal(result.mfeReturnExcluded.length, 1);
  assert.equal(JSON.stringify(cycles), original);
});

test("full linear range keeps outliers and guides, including over 100% and negative retention", () => {
  for (const samples of [[], [base], [base, { ...base, id: "outlier", mfePct: 8, returnPct: -20 }]]) {
    const data = buildBehaviorMatrices(samples);
    for (const kind of ["mfeReturn", "maeReturn"]) {
      const domain = matrixDomains(data[kind], kind);
      assert.ok(domain.x[1] > domain.x[0]);
      assert.ok(domain.y[1] > domain.y[0]);
      assert.ok(data[kind].every(p => matrixVisible(p, kind, domain)));
      assert.ok(domain.x[0] <= 0 && domain.x[1] >= 0);
      assert.ok(domain.y[0] <= 0 && domain.y[1] >= 0);
      if (kind === "maeReturn") assert.ok(domain.x[0] <= -0.1);
      const ticks = matrixTicks(domain.x, 7);
      assert.ok(ticks.every(t => t >= domain.x[0] && t <= domain.x[1]));
      assert.ok(ticks.length <= 7);
    }
  }
});

test("dots, zero, guides and inverse pointer coordinates share one transform at any size", () => {
  const domains = { x: [-0.32, 0.11], y: [-2, 1.5] };
  for (const [width, height] of [[320, 320], [640, 360], [1280, 460]]) {
    const g = matrixGeometry(domains, width, height);
    for (const value of [-0.1, 0, 0.1]) near(g.valueX(g.x(value)), value);
    for (const value of [-1.5, 0, 0.5, 1]) near(g.valueY(g.y(value)), value);
    assert.ok(g.contains(g.x(0), g.y(0)));
    assert.equal(g.contains(g.left - 1, g.top), false);
    const next = matrixBoxZoom(g, { x: g.x(0.05), y: g.y(-1) }, { x: g.x(-0.2), y: g.y(1) });
    near(next.x[0], -0.2); near(next.x[1], 0.05);
    near(next.y[0], -1); near(next.y[1], 1);
    assert.equal(matrixBoxZoom(g, { x: 100, y: 100 }, { x: 101, y: 102 }), null);
  }
});

test("overlapping points remain distinct, selected by proximity without jitter", () => {
  const data = buildBehaviorMatrices([base, { ...base, id: "two", symbol: "BBB" }]).mfeReturn;
  const domain = matrixDomains(data, "mfeReturn"), g = matrixGeometry(domain, 640, 360);
  const value = matrixCoordinates(data[0], "mfeReturn");
  assert.deepEqual(matrixCoordinates(data[1], "mfeReturn"), value);
  const pixel = { x: g.x(value.x), y: g.y(value.y) };
  assert.equal(nearbyMatrixPoints(data, "mfeReturn", g, pixel).length, 2);
  assert.equal(nearbyMatrixPoints(data, "mfeReturn", g, { x: 0, y: 0 }).length, 0);
});

test("zoom is bounded by full range and sample counts do not change source data", () => {
  const data = buildBehaviorMatrices([base, { ...base, id: "outlier", mfePct: 10, returnPct: -1 }]).mfeReturn;
  const full = matrixDomains(data, "mfeReturn");
  const zoom = zoomMatrix(full, full, 0.1, { x: 0.2, y: 0.08 });
  assert.equal(data.filter(p => matrixVisible(p, "mfeReturn", zoom)).length, 1);
  assert.equal(data.length, 2);
  const reset = zoomMatrix(zoom, full, 100, null);
  near(reset.x[0], full.x[0]); near(reset.x[1], full.x[1]);
  near(reset.y[0], full.y[0]); near(reset.y[1], full.y[1]);
});

test("percent labels do not turn small nonzero values or missing values into zero", () => {
  assert.equal(matrixPercent(null), "—");
  assert.equal(matrixPercent(0), "0%");
  assert.equal(matrixPercent(-0), "0%");
  assert.equal(matrixPercent(0.000001), "0.0001%");
  assert.equal(matrixPercent(-0.2), "-20%");
  assert.equal(matrixPercent(1.5), "150%");
});

test("compressed reference captions stay separated and connected to their true values", () => {
  const g = matrixGeometry({ x: [0, 1], y: [-20, 10] }, 320, 320);
  const labels = matrixReferenceLabels([0, 0.5, 1], g);
  assert.equal(labels.length, 3);
  labels.forEach((label, index) => {
    near(label.y, g.y(label.value));
    if (index) assert.ok(label.labelY - labels[index - 1].labelY >= 15);
  });
});


test("both Y axes use actual return, even for zero/negative MFE and partial data", () => {
  const data = buildBehaviorMatrices([
    base, { ...base, id: "zero", mfePct: 0, returnPct: -0.03 },
    { ...base, id: "negative", mfePct: -0.01, returnPct: -0.04 },
    { ...base, id: "only-mae", mfePct: null, returnPct: 0.3 },
    { ...base, id: "only-mfe", maePct: null, returnPct: -0.2 },
  ]);
  for (const kind of ["mfeReturn", "maeReturn"]) {
    const sharedY = matrixSharedY(data);
    const domain = matrixDomains(data[kind], kind, sharedY);
    assert.deepEqual(domain.y, sharedY);
    assert.ok(domain.y[0] < -0.2 && domain.y[1] > 0.3);
    for (const point of data[kind]) assert.equal(matrixCoordinates(point, kind).y, point.returnPct);
  }
  assert.equal(data.mfeReturn.find(p => p.cycleId === "negative").retention, null);
  assert.equal(data.mfeReturn.find(p => p.cycleId === "zero").retention, null);
  assert.equal(data.mfeReturn.length, 4);
  assert.equal(data.maeReturn.length, 4);
});

test("agreed comparison examples use percentage points and positive inverse amplitude", () => {
  const first = buildBehaviorMatrices([base]).mfeReturn[0];
  near(matrixDifference(first, "mfeReturn"), 0.12);
  near(first.retention, 0.4);
  assert.equal(matrixPercentagePoints(matrixDifference(first, "mfeReturn")), "+12 個百分點");
  const loss = { ...base, returnPct: -0.04 };
  near(matrixDifference(loss, "maeReturn"), 0.06);
  assert.equal(matrixPercentagePoints(matrixDifference(loss, "maeReturn")), "+6 個百分點");
  const profit = { ...base, returnPct: 0.12 };
  near(matrixDifference(profit, "maeReturn"), 0.22);
  near(matrixAmplitudeRatio(profit), 1.2);
  for (const point of [loss, { ...profit, maePct: 0 }, { ...profit, maePct: 0.1 }, { ...profit, returnPct: 0 }, { ...profit, maePct: null }]) assert.equal(matrixAmplitudeRatio(point), null);
  assert.equal(matrixDifference({ ...base, mfePct: null }, "mfeReturn"), null);
  assert.equal(matrixPercentagePoints(null), "—");
  near(matrixDifference({ ...base, returnPct: 0.3 }, "mfeReturn"), -0.1);
  near(matrixDifference({ ...base, returnPct: -0.12 }, "maeReturn"), -0.02);
});

test("Y=X clips in data space for both signs, asymmetric scales, zoom and empty intersections", () => {
  const cases = [
    { domain: { x: [-0.2, 0.4], y: [-0.1, 0.2] }, expected: { start: { x: -0.1, y: -0.1 }, end: { x: 0.2, y: 0.2 } } },
    { domain: { x: [0.1, 0.4], y: [-0.2, 0.3] }, expected: { start: { x: 0.1, y: 0.1 }, end: { x: 0.3, y: 0.3 } } },
    { domain: { x: [-0.3, -0.1], y: [-0.4, -0.2] }, expected: { start: { x: -0.3, y: -0.3 }, end: { x: -0.2, y: -0.2 } } },
    { domain: { x: [0.2, 0.4], y: [-0.1, 0.1] }, expected: null },
  ];
  for (const { domain, expected } of cases) {
    const segment = matrixEqualitySegment(domain);
    assert.deepEqual(segment, expected);
    if (!segment) continue;
    for (const width of [320, 640, 1100]) {
      const g = matrixGeometry(domain, width, 360);
      for (const point of [segment.start, segment.end]) { near(g.valueX(g.x(point.x)), g.valueY(g.y(point.y))); assert.ok(g.contains(g.x(point.x), g.y(point.y))); }
    }
  }
});

test("Y=-X never extends into positive MAE or negative return", () => {
  for (const domain of [{ x: [-0.3, 0.2], y: [-0.1, 0.2] }, { x: [-0.15, 0.2], y: [0.05, 0.1] }]) {
    const line = matrixEqualitySegment(domain, true);
    assert.ok(line);
    for (const point of [line.start, line.end]) { assert.ok(point.x <= 0); assert.ok(point.y >= 0); near(point.y, -point.x); }
  }
  assert.equal(matrixEqualitySegment({ x: [0.1, 0.2], y: [0, 0.3] }, true), null);
  assert.equal(matrixEqualitySegment({ x: [-0.2, 0], y: [-0.2, -0.1] }, true), null);
});

test("direction and scale changes do not change comparisons, costs or fill data", () => {
  const cycles = [base, { ...base, id: "short", direction: "SHORT", fills: [{ quantity: 10 }, { quantity: 5 }, { quantity: 3 }], entryNotional: 1500, fees: 8, returnPct: -0.04 }];
  const before = JSON.stringify(cycles), data = buildBehaviorMatrices(cycles);
  assert.equal(JSON.stringify(cycles), before);
  for (const point of data.mfeReturn) {
    assert.deepEqual(matrixCoordinates(point, "mfeReturn"), { x: 0.2, y: point.returnPct });
    const other = data.maeReturn.find(p => p.cycleId === point.cycleId);
    assert.equal(other.category, point.category);
  }
});
