import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const init = readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");
test("appearance restores only a valid device preference and tolerates blocked storage", () => {
  for (const value of ["light", "dark", null, "invalid"]) {
    const document = { documentElement: { dataset: {} } };
    runInNewContext(init, { document, localStorage: { getItem(key) { assert.equal(key, "traders-gym:appearance"); return value; } } });
    assert.equal(document.documentElement.dataset.theme, value === "light" ? "light" : "dark");
  }
  const document = { documentElement: { dataset: {} } };
  runInNewContext(init, { document, localStorage: { getItem() { throw Error("blocked"); } } });
  assert.equal(document.documentElement.dataset.theme, "dark");
});
test("theme adapter changes chart paint, not drawing calls or coordinates", () => {
  const source = readFileSync(new URL("../app/chart-theme.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  runInNewContext(code, { exports, document: { documentElement: {} }, getComputedStyle: () => ({ getPropertyValue: () => "#127353" }) });
  const calls = [];
  const context = { fillStyle: "", fillRect(...args) { assert.equal(this, context); calls.push(args); } };
  const themed = exports.themedContext({ getContext: () => context });
  themed.fillStyle = "#69c6a7";
  themed.fillRect(10, 20, 30, 40);
  assert.equal(context.fillStyle, "#127353");
  assert.deepEqual(calls, [[10, 20, 30, 40]]);
});
test("theme toolbar stays outside account storage and trade save APIs", () => {
  const source = readFileSync(new URL("../app/theme-toolbar.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|\/api\/|sessionStorage|trade-records/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /removeEventListener\("storage"/);
  assert.match(source, /observer.disconnect\(\)/);
});
