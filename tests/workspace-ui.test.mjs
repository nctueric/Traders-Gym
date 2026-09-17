import test from "node:test";
import assert from "node:assert/strict";
import { renderTraining, parityCases } from "./render-workspace.mjs";

// Captured from the unmodified local UI before the redesign (2026-08-28).
// Hashes include exact engine arguments AND results, not markup or CSS strings.
const baseline = {
  "long-short-mixed-flat-unrated": "c539d903008334a7526c12012b4738a236cc980bc80c57ed8edc5bad597626ee",
  "missing-prices-fx": "641ee84d171b1eb1fd89f53c7a77e20104de5b9f61b53786db0f9d97ed4f0325",
  "legacy-no-ratings": "9178dae442da3fa9f4af90d2a45a7f473fbf08c204f6d322751c16226c6019c4",
  "empty": "2e636ee21dd86699da0c5fd965172d62e3555fb6874ead83be2d064bd6125445",
  "latest-ten": "6e7c80cddb59e4fa43f6f10b0bc6eae55ac4b4085c5beb0fbc9be770d718fe1d",
  "month": "85a0d1ca23f32c5ffebfb49e249519cccebcd2007ce9622934d0b54f0a2251f7",
  "strategy-version-month": "7d6ec2390863733571e709a88ec1a459370be137b820af3e01640bd2fe94f980",
};
for (const entry of parityCases) test("UI preserves pre-redesign samples and calculations: " + entry.name, () => {
  const result=renderTraining(entry);
  assert.equal(result.digest, baseline[entry.name]);
  assert.equal(result.unchanged,true);
});
test("rating, performance, audit, then objective evidence follow the task hierarchy", () => {
  const {html}=renderTraining();
  const markers=['id="quality-rating"','id="quick-rating"','id="performance-structure"','id="strategy-audit"','id="price-evidence"'];
  let previous=-1;
  for(const marker of markers) { const current=html.indexOf(marker); assert.ok(current>previous,marker); previous=current; }
  for(const marker of markers.filter(x=>!x.includes("quick-rating"))) assert.ok(html.includes('href="#'+marker.slice(4,-1)+'"'));
  assert.match(html,/全時段曲線依策略、版本及成交登錄證據篩選/);
  assert.match(html,/aria-label="期望值圖表，可橫向捲動"/);
});
test("full-period trend keeps all strategy samples when rating subset is limited", () => {
  const {calls}=renderTraining({filters:["month","qa-strategy","qa-strategy-v1","2026-08","10"]});
  assert.equal(calls.find(c=>c.name==="buildMonthlyExpectancyTrend").args[0].length,21);
  assert.equal(calls.find(c=>c.name==="buildTradeQualityAnalysis").args[0].length,3);
  assert.equal(calls.find(c=>c.name==="buildStrategyAnalysis").args[0].length,3);
});
test("review ledger renders the requested read-only columns and retains K-line access",()=>{
 const {html}=renderTraining();const table=html.slice(html.indexOf('id="quick-rating"'),html.indexOf('id="performance-structure"'));
 const columns=['閉環','交易損益（＄）','交易損益率','持倉時間（交易日）','投入金額（＄）','投入時部位比（％）','交易期望值','進場評價','出場評價','進場後3日','MAE','MFE','出場後5日','K線'];
 const headers=[...table.matchAll(/<th\b[^>]*>(.*?)<\/th>/g)].map(m=>m[1].replace(/<[^>]+>/g,""));
 assert.deepEqual(headers,columns);
 assert.doesNotMatch(table,/type="radio"|進場位置旁證|出場位置旁證|回顧證據/);
 assert.match(table,/看 K 線與復盤/);assert.match(table,/重新整理估值/);
});
