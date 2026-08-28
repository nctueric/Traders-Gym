import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as quality from "../lib/quality-rating.mjs";

// Exercise the actual TSX component without adding a browser or test framework.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/quality-rating-control.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentModule = { exports: {} };
new Function("require", "module", "exports", compiled)((id) => id === "@/lib/quality-rating.mjs" ? quality : require(id), componentModule, componentModule.exports);
const { QualityTagPicker } = componentModule.exports;
const picker = (props) => React.createElement(QualityTagPicker, { cycle: { id: "same", pnl: 100 }, kind: "entry", onChange() {}, ...props });

test("detail and ledger instances have independent unique radio ids and groups", () => {
  const html = renderToStaticMarkup(React.createElement("div", null,
    picker({ value: "IDEAL" }), picker({ value: "IDEAL", compact: true, cycle: { cycleId: "same", pnl: 100 } }),
    picker({ cycle: { cycleId: "another", pnl: -1 }, value: "LATE", compact: true })));
  const ids = [...html.matchAll(/<input[^>]* id="([^"]+)"/g)].map((match) => match[1]);
  const groups = [...html.matchAll(/<input[^>]* name="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, 12);
  assert.equal(new Set(groups).size, 3);
  assert.equal((html.match(/checked=""/g) || []).length, 3);
  for (const id of ids) assert.ok(html.includes('for="' + id + '"'));
});

test("selected state is replaced and profit/loss wording follows final pnl", () => {
  const early = renderToStaticMarkup(picker({ value: "EARLY" }));
  const late = renderToStaticMarkup(picker({ value: "LATE" }));
  assert.match(early, /checked="" value="EARLY"/);
  assert.match(late, /checked="" value="LATE"/);
  assert.equal((late.match(/checked=""/g) || []).length, 1);
  const profit = renderToStaticMarkup(picker({ kind: "exit", value: "IDEAL" }));
  const stop = renderToStaticMarkup(picker({ kind: "exit", cycle: { id: "flat", pnl: 0 } }));
  assert.match(profit, /獲利離場點/);
  assert.match(profit, /不要求賣在最高點/);
  assert.match(stop, /止損離場點/);
  assert.match(stop, /待評/);
  assert.equal((stop.match(/checked=""/g) || []).length, 0);
});
