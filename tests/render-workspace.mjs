import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { summarize } from "../lib/trade-engine.mjs";
import { fixtureDataset } from "./ui-fixture-data.mjs";

const require = createRequire(import.meta.url);
const app = new URL("../app/", import.meta.url);
const engineFunctions = new Set(["buildTradeQualityAnalysis", "buildBehaviorDashboard", "buildProfitLossTradeStats", "buildMonthlyExpectancyTrend", "buildStrategyAnalysis"]);

export function renderTraining({scenario = "rich", filters = ["all", "", "", "", "0"], source, entryContexts = {}} = {}) {
  const calls = [], cache = new Map();
  let stateIndex = 0;
  const react = { ...React, useState(initial) {
    const index = stateIndex++;
    return React.useState(index < filters.length ? filters[index] : initial);
  }};
  function load(file, override) {
    if (cache.has(file.href)) return cache.get(file.href);
    const compiled = ts.transpileModule(override || readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    const componentModule = { exports: {} };
    cache.set(file.href, componentModule.exports);
    new Function("require", "module", "exports", compiled)((id) => {
      if (id === "react") return react;
      if (id.startsWith("./")) return load(new URL(id + ".tsx", file));
      if (id.startsWith("@/lib/")) {
        const actual = require("../lib/" + id.slice("@/lib/".length));
        return Object.fromEntries(Object.entries(actual).map(([name, value]) => [name, engineFunctions.has(name) ? (...args) => {
          const result = value(...args); calls.push({ name, args, result }); return result;
        } : value]));
      }
      return require(id);
    }, componentModule, componentModule.exports);
    return componentModule.exports;
  }
  const dataset = fixtureDataset(scenario);
  const before = JSON.stringify(dataset);
  const report = summarize(dataset);
  const props = { dataset, fetchHistory: fetch, cycles: report.cycles, marketBars: dataset.marketBars, reviews: dataset.cycleReviews || {}, fxRate: scenario === "missing" ? null : 32, strategies: dataset.strategies || [], strategyAssignments: dataset.strategyAssignments || {}, entryContexts, onSelectCycle() {}, onQualityRatingChange() {} };
  const html = renderToStaticMarkup(React.createElement(load(new URL("training-workspace.tsx", app), source).TrainingWorkspace, props));
  const digest = createHash("sha256").update(JSON.stringify([...calls].map(call=>{
    if(call.name!=="buildProfitLossTradeStats")return call;
    // Preserve the established calculation contract; additive metrics have their own numeric tests.
    const result=structuredClone(call.result);
    delete result.totalPnlUsd;delete result.missingFxCount;
    for(const group of [result.winners,result.losers])for(const key of ['totalPnlUsd','missingFxCount','averageHoldingDays','missingHoldingDays'])delete group[key];
    return {...call,result};
  }).sort((a,b) => a.name.localeCompare(b.name)))).digest("hex");
  return { html, calls, digest, unchanged: before === JSON.stringify(dataset) };
}
export const parityCases = [
  { name: "long-short-mixed-flat-unrated", scenario: "rich" },
  { name: "missing-prices-fx", scenario: "missing" },
  { name: "legacy-no-ratings", scenario: "legacy" },
  { name: "empty", scenario: "empty" },
  { name: "latest-ten", filters: ["all", "", "", "", "10"] },
  { name: "month", filters: ["month", "", "", "2026-08", "0"] },
  { name: "strategy-version-month", filters: ["month", "qa-strategy", "qa-strategy-v1", "2026-08", "10"] },
];
