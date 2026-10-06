import test from "node:test";
import assert from "node:assert/strict";
import { renderTraining, parityCases } from "./render-workspace.mjs";

// Removed trend and audit panels; verified every remaining engine argument and result against the prior UI.
// Hashes include exact engine arguments AND results, not markup or CSS strings.
const baseline = {
  "long-short-mixed-flat-unrated": "9ef96c812d8fb1baa5e4cf72f0ececf7c24a3e65374dda26fae41b2e87756116",
  "missing-prices-fx": "dee60020c6572e56d99af62810456048014e8cdd633b856fac43c4fe9cc59e02",
  "legacy-no-ratings": "b27273bbc99f6d3c0958098ddd685bb00921321a4c99ac3e31bb8717d095e7b8",
  "empty": "2fec8f8ab82444ccd3fe429b54e39650ec5417a5ee8602a108d2cd056e36b75f",
  "latest-ten": "3003c885291e1fa1c761b88ea9b8f9c038b035b145d1c9190d76bc4d5f0cec7a",
  "month": "22e47726b4b874869eab877bddbe47b756a58dced8ac2787180a15ec55eb6386",
  "strategy-version-month": "04fe9999eca4ecd9a79e2928098ed158fa5ff90796e9b2fc48ed04b640372e5d",
};
for (const entry of parityCases) test("UI preserves filtered samples and calculation contracts: " + entry.name, () => {
  const result=renderTraining(entry);
  assert.equal(result.digest, baseline[entry.name]);
  assert.equal(result.unchanged,true);
});
test("performance, returns, then review follow the task hierarchy", () => {
  const {html}=renderTraining();
  const markers=['id="performance-structure"','id="return-analysis"','id="quality-rating"','id="quick-rating"'];
  let previous=-1;
  for(const marker of markers) { const current=html.indexOf(marker); assert.ok(current>previous,marker); previous=current; }
  for(const id of ['performance-structure','return-analysis','quality-rating']) {
    assert.ok(html.includes(`aria-controls="${id}"`));
    assert.ok(html.includes(`aria-labelledby="${id}-tab"`));
  }
  assert.equal((html.match(/role="tabpanel"/g)||[]).length,3);
  assert.equal((html.match(/aria-selected="true"/g)||[]).length,1);
  assert.doesNotMatch(html,/href="#(?:performance-structure|return-analysis|quality-rating)"/);
  assert.doesNotMatch(html,/成交登錄證據篩選|全時段交易優勢曲線|策略遵守與違規比較|客觀價格旁證|href="#strategy-audit"|href="#price-evidence"/);
  assert.match(html,/aria-label="期望值圖表，可橫向捲動"/);
});
test("remaining analyses retain the selected strategy, period and sample range", () => {
  const {calls}=renderTraining({filters:["month","qa-strategy","qa-strategy-v1","2026-08","10"]});
  assert.ok(!calls.some(c=>c.name==="buildMonthlyExpectancyTrend" || c.name==="buildStrategyAnalysis"));
  assert.equal(calls.find(c=>c.name==="buildTradeQualityAnalysis").args[0].length,3);
  assert.equal(calls.find(c=>c.name==="buildBehaviorDashboard").args[0].length,3);
});
test("review ledger renders the requested read-only columns and retains K-line access",()=>{
 const {html}=renderTraining();const table=html.slice(html.indexOf('id="quick-rating"'));
 const columns=['閉環','交易損益（＄）','交易損益率','持倉時間（交易日）','投入金額（＄）','投入時部位比（％）','交易期望值','進場評價','出場評價','進場後3日','MAE','MFE','出場後5日','K線'];
 const headers=[...table.matchAll(/<th\b[^>]*>(.*?)<\/th>/g)].map(m=>m[1].replace(/<[^>]+>/g,""));
 assert.deepEqual(headers,columns);
 assert.doesNotMatch(table,/type="radio"|進場位置旁證|出場位置旁證|回顧證據/);
 assert.match(table,/看 K 線與復盤/);assert.match(table,/重新整理估值/);
});
