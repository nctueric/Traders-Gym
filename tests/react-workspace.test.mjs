import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
const require=createRequire(import.meta.url);
const source=readFileSync(new URL("../app/workspace-ui.tsx",import.meta.url),"utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const loadedModule={exports:{}};
new Function("require","module","exports",code)(require,loadedModule,loadedModule.exports);
test("detail is a non-modal region with keyboard reachable controls",()=>{
 const html=renderToStaticMarkup(React.createElement(loadedModule.exports.DetailFrame,{label:"測試持倉",onClose(){}},React.createElement("input",{defaultValue:"尚未提交"})));
 assert.match(html,/aria-label="測試持倉"/);
 assert.doesNotMatch(html,/<dialog|aria-modal/);
 assert.match(html,/返回清單/);assert.match(html,/aria-expanded="true"/);assert.match(html,/aria-pressed="false"/);
 assert.match(html,/value="尚未提交"/);
});
test("new detail state stays outside the transaction and storage modules",()=>{
 assert.doesNotMatch(source,/localStorage|sessionStorage|\/api\/|JSON\.stringify/);
 const workspace=readFileSync(new URL("../app/trade-workspace.tsx",import.meta.url),"utf8");
 assert.match(workspace,/CycleReviewDialog key=\{selectedCycle.id\}/);
 assert.match(workspace,/data-detail-dirty/);
});
test("split breakpoint and retained hidden content are explicit",()=>{
 const css=readFileSync(new URL("../app/react-workspace.css",import.meta.url),"utf8");
 assert.match(css,/@media\(min-width:1200px\)/);
 assert.match(css,/@media\(max-width:1199px\)/);
 assert.match(source,/hidden=\{collapsed\}/);
 assert.match(source,/preventScroll:true/);
});
