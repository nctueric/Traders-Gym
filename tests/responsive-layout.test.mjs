import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

// Reuse the build tool's CSS parser; no browser or additional dependency needed.
const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve("vite"))("postcss");
const stylesheet = postcss.parse(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"));
function stylesAt(selector, width) {
  const styles = {};
  stylesheet.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type !== "atrule" || parent.name !== "media") continue;
      for (const match of parent.params.matchAll(/(min|max)-width:\s*(\d+)px/g)) {
        if (match[1] === "min" && width < Number(match[2]) || match[1] === "max" && width > Number(match[2])) return;
      }
    }
    rule.walkDecls((declaration) => { styles[declaration.prop] = declaration.value; });
  });
  return styles;
}


test("desktop uses all available width with bounded gutters and three primary metrics", () => {
  for (const width of [1024, 1440, 1920, 2560, 3440]) {
    assert.equal(stylesAt(".shell", width)["grid-template-columns"], "230px minmax(0,1fr)");
    assert.equal(stylesAt(".content", width)["max-width"], "none");
    assert.equal(stylesAt(".content", width)["min-width"], "0");
    const padding = stylesAt(".content", width).padding;
    assert.ok(Number.parseFloat(padding) <= 24, "compact upper gutter");
    assert.match(padding, /clamp\(/, "wide screens retain bounded fluid gutters");
    assert.match(stylesAt(".metrics", width)["grid-template-columns"], /repeat\(3,/);
    assert.equal(stylesAt(".table-wrap", width)["overflow-x"], "auto");
    assert.match(stylesAt(".table-wrap", width)["max-height"], /vh/);
  }
  assert.equal(stylesAt(".strategy-metrics", 2560)["grid-template-columns"], "repeat(8, minmax(0, 1fr))");
  assert.match(stylesAt(".detail-dialog", 2560).width, /2400px/);
});

test("mobile navigation opens explicitly and tables scroll without shrinking text", () => {
  for (const width of [390, 760]) {
    assert.equal(stylesAt(".shell", width)["grid-template-columns"], "1fr");
    assert.equal(stylesAt(".sidebar nav", width).display, "none");
    assert.equal(stylesAt(".sidebar nav.is-open", width).display, "grid");
    assert.equal(stylesAt(".sidebar nav button", width)["white-space"], "nowrap");
    assert.ok(Number.parseFloat(stylesAt(".mobile-nav-toggle", width)["min-height"]) >= 44);
    assert.equal(stylesAt(".quality-distribution-grid", width)["grid-template-columns"], "1fr");
    assert.equal(stylesAt(".strategy-layout", width)["grid-template-columns"], "minmax(0,1fr)");
    assert.ok(Number.parseFloat(stylesAt("button", width)["min-height"]) >= 44);
  }
  assert.equal(stylesAt(".metrics", 390)["grid-template-columns"], "1fr");
});

test("overview has three categories with asset history and plan editing inside disclosures", () => {
  const source = ts.createSourceFile("trade-workspace.tsx", readFileSync(new URL("../app/trade-workspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements = [];
  const visit = node => { if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node); ts.forEachChild(node, visit); };
  visit(source);
  const className = node => node.openingElement?.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.text === "className")?.initializer?.text;
  const metrics = elements.find(node => className(node) === "metrics");
  const metadata = elements.find(node => className(node) === "secondary-metrics");
  const chart = elements.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "MonthlyAssets");
  assert.ok(metrics && metadata && chart);
  assert.match(metrics.getText(source), /metrics\.slice\(0, 3\)/);
  assert.match(metrics.getText(source), /<EquityBreakdown equity=\{currentEquity\}/);
  assert.equal(chart.parent.openingElement.tagName.getText(source), "OverviewDisclosure");
  assert.equal(chart.parent.parent.pos, metrics.parent.pos);
  assert.equal(metrics.parent.pos, metadata.parent.pos);
  assert.ok(metrics.end < metadata.pos && metadata.end < chart.pos);
  assert.match(chart.getText(source), /data=\{data\} quotes=\{quotes\} fxRate=\{fxRate\} asOf=\{currentEquity\.asOf\}/);
  assert.doesNotMatch(stylesheet.toString(), /overview-finances|overview-equity|overview-results/);
  const page = source.getFullText();
  for (const id of ["overview-assets", "overview-holdings", "overview-trade-metrics"]) assert.match(page, new RegExp(`id="${id}"`));
  assert.doesNotMatch(page, /\["positions", "目前持倉"\]|tab === "positions" &&/);
  const plans = elements.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "PositionsPanel");
  assert.equal(plans.parent.openingElement.tagName.getText(source), "OverviewDisclosure");
  assert.match(plans.getText(source), /onPlanChange=\{updatePositionPlan\} onPlanCommit=\{commitPositionPlan\} onOpenChart=\{openPositionChart\}/);
  assert.equal(stylesAt(".overview-section .panel", 1440).border, "0");
  assert.equal(stylesAt(".overview-disclosure > summary", 390)["min-height"], "44px");
});

test("essential CSS text never drops below 12px and reduced motion is supported", () => {
  stylesheet.walkDecls("font-size", declaration => {
    if (/^\d+(\.\d+)?px$/.test(declaration.value))
      assert.ok(Number.parseFloat(declaration.value) >= 12, declaration.parent.selector + ": " + declaration.value);
  });
  const reduced = [];
  stylesheet.walkAtRules("media", rule => { if (rule.params.includes("prefers-reduced-motion")) reduced.push(rule.toString()); });
  assert.match(reduced.join(""), /animation:\s*none/);
  assert.match(reduced.join(""), /transition:\s*none/);
  assert.equal(stylesAt(".positions-table > thead > tr:nth-child(2) > th", 1440).top, "36px");
  assert.equal(stylesAt(".position-transactions-table :is(th,td)", 1440).position, "static");
});

function contrast(a,b) {
  const luminance = hex => hex.match(/[0-9a-f]{2}/gi).map(c=>parseInt(c,16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4).reduce((sum,c,index)=>sum+c*[0.2126,0.7152,0.0722][index],0);
  const x=luminance(a), y=luminance(b);
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
}
test("core text and semantic colors meet 4.5:1 contrast", () => {
  for (const [text,background] of [["17211f","f4f6f5"],["53645c","f4f6f5"],["176b50","ffffff"],["a8463b","ffffff"],["8c3027","fff0ed"],["ffffff","2a4037"]])
    assert.ok(contrast(text,background)>=4.5, text+" on "+background);
});
