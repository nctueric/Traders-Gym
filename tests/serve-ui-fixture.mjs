// Local-only, in-memory QA harness. No credentials, production DB, or upstream API.
import { gunzipSync } from "node:zlib";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { fixtureDataset, fixtureBars } from "./ui-fixture-data.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({
  configFile: false, root, logLevel: "warn",
  resolve: { alias: { "@": root } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { write: false, lib: { entry: root + "tests/ui-fixture.tsx", formats: ["es"], fileName: "fixture", cssFileName: "fixture" } },
});
const output = result.output || result[0].output;
const assets = new Map(output.map(item => ["/" + item.fileName, item.type === "chunk" ? item.code : item.source]));
const script = output.find(item => item.type === "chunk").fileName;
const css = (scenario) => output.filter(item => item.fileName.endsWith(".css")).map(item => `<link rel="stylesheet" href="/${item.fileName}?scenario=${encodeURIComponent(scenario)}">`).join("");
const states = new Map();
function stateFor(scenario) {
  if (!states.has(scenario)) states.set(scenario, {
    account: { id: "qa-main", name: scenario === "long-text" ? "隔離長帳號名称".repeat(12) : "隔離 UI 測試帳號", version: 1, updatedAt: "2026-08-28T00:00:00Z" },
    dataset: fixtureDataset(scenario), writes: 0,
  });
  return states.get(scenario);
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const scenario = url.searchParams.get("scenario") || "rich";
  const state = stateFor(scenario);
  const json = (body, status = 200) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(body)); };
  if (url.pathname === "/api/trade-records") {
    if (scenario === "slow") await new Promise(resolve => setTimeout(resolve, 2000));
    if (scenario === "load-error") return json({ error: "隔離測試：帳號載入失敗" }, 503);
    if (request.method === "PUT") {
      if (scenario === "save-error") return json({ error: "隔離測試：儲存失敗，請重試" }, 503);
      const chunks=[]; for await (const chunk of request) chunks.push(chunk);
      const raw=Buffer.concat(chunks);
      const body = JSON.parse((request.headers["content-encoding"]==="gzip"?gunzipSync(raw):raw).toString());
      if (body.baseVersion != null && body.baseVersion !== state.account.version) return json({ error: "Conflict" }, 409);
      state.dataset = body.dataset; state.account = { ...state.account, name: body.accountName, version: state.account.version + 1, updatedAt: new Date().toISOString() }; state.writes++;
      return json({ account: state.account });
    }
    return json({ account: state.account, dataset: state.dataset, accounts: [state.account] });
  }
  if (url.pathname === "/api/quotes") {
    const symbols = (url.searchParams.get("symbols") || "").split(",");
    if (scenario === "missing") return json({ quotes: [], errors: ["隔離測試：缺少行情與匯率"] });
    return json({ quotes: symbols.map(symbol => ({ symbol, price: symbol === "USDTWD=X" ? 32 : 110, previousClose: symbol === "USDTWD=X" ? 32 : 108, changePct: 0.02, currency: symbol === "USDTWD=X" ? "TWD" : "USD", marketState: "CLOSED", updatedAt: scenario === "stale" ? "2025-01-01T00:00:00Z" : new Date().toISOString(), source: "QA synthetic" })), errors: [] });
  }
  if (url.pathname === "/api/history") return json({ ...(url.searchParams.get("live")==="true" ? {live:{quoteTime:new Date().toISOString(),tradingDate:new Date().toISOString().slice(0,10),sessionComplete:false}} : {}), ...(url.searchParams.has("priceBasis") ? {priceBasis:url.searchParams.get("priceBasis")} : {}), bars: scenario === "missing" ? [] : fixtureBars(url.searchParams.get("datasetSymbol") || url.searchParams.get("symbol") || "SPY"), source: "QA synthetic" });
  if (url.pathname === "/__qa/state") return json(state);
  if (url.pathname === "/fixture.json") return json(fixtureDataset("rich"));
  if (url.pathname === "/record-serializer.worker.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); return response.end(readFileSync(root + "public/record-serializer.worker.js")); }
  if (assets.has(url.pathname)) { response.writeHead(200, { "Content-Type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript" }); return response.end(url.pathname.endsWith(".css") && scenario.endsWith("-dark") ? String(assets.get(url.pathname)).replace(/@media\s*\(prefers-color-scheme:\s*dark\)/g,"@media (min-width:0px)") : assets.get(url.pathname)); }
  if (url.pathname.startsWith("/api/")) return json({ error: "Unknown QA endpoint" }, 404);
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>隔離測試｜交易復盤顧問</title>${css(scenario)}</head><body><div id="root"></div><script type="module" src="/${script}"></script></body></html>`);
});
server.listen(0, "127.0.0.1", () => console.log(`QA fixture: http://127.0.0.1:${server.address().port} (memory only)`));
