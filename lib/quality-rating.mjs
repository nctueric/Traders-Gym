export const ENTRY_QUALITY_TAGS = [
  { value: "EARLY", label: "太早", description: "計畫條件或觸發尚未完成。" },
  { value: "LATE", label: "太遲", description: "有效訊號已明顯延伸，形成追價或風報比惡化。" },
  { value: "IDEAL", label: "完美", description: "符合原計畫觸發與可接受的風險區間。" },
  { value: "WRONG_ENTRY", label: "錯誤買點", description: "缺少有效交易條件、違反策略，或原本不應進場。" },
];

export const PROFIT_EXIT_QUALITY_TAGS = [
  { value: "EARLY", label: "太早", description: "計畫與趨勢仍有效時提前退出。" },
  { value: "LATE", label: "太遲", description: "錯過計畫離場並產生明顯獲利回吐。" },
  { value: "IDEAL", label: "完美", description: "依計畫獲利了結並保留合理MFE，不要求賣在最高點。" },
];

export const STOP_EXIT_QUALITY_TAGS = [
  { value: "EARLY", label: "太早", description: "失效條件尚未成立就退出。" },
  { value: "LATE", label: "太遲", description: "超過原停損或失效條件後才退出。" },
  { value: "IDEAL", label: "完美", description: "按原計畫停損或失效條件執行。" },
];

const ENTRY_VALUES = new Set(ENTRY_QUALITY_TAGS.map((tag) => tag.value));
const EXIT_VALUES = new Set(PROFIT_EXIT_QUALITY_TAGS.map((tag) => tag.value));

export function normalizeEntryQualityTag(value) { return ENTRY_VALUES.has(value) ? value : null; }
export function normalizeExitQualityTag(value) { return EXIT_VALUES.has(value) ? value : null; }
export function exitQualityGroup(cycle) { return Number(cycle?.pnl) > 0 ? "PROFIT_EXIT" : "STOP_EXIT"; }

export function updateQualityRating(review = {}, field, value, ratedAt = new Date().toISOString()) {
  if (!["entryQualityTag", "exitQualityTag"].includes(field)) throw new Error("未知的交易品質欄位");
  const tag = field === "entryQualityTag" ? normalizeEntryQualityTag(value) : normalizeExitQualityTag(value);
  if (!tag) throw new Error("無效的交易品質標籤");
  return { ...review, [field]: tag, qualityRatedAt: ratedAt, updatedAt: ratedAt };
}

function buildGroup(id, title, cycles, reviews, field, definitions) {
  const rows = cycles.map((cycle) => ({ cycle, value: field === "entryQualityTag" ? normalizeEntryQualityTag(reviews?.[cycle.id]?.[field]) : normalizeExitQualityTag(reviews?.[cycle.id]?.[field]) }));
  const rated = rows.filter((row) => row.value);
  const items = definitions.map((definition) => {
    const matches = rated.filter((row) => row.value === definition.value);
    return { ...definition, count: matches.length, rate: rated.length ? matches.length / rated.length : null, cycleIds: matches.map((row) => row.cycle.id) };
  });
  // Largest remainder rounding keeps the displayed one-decimal shares at 100%.
  const tenths = items.map((item) => rated.length ? Math.floor(item.count * 1000 / rated.length) : 0);
  if (rated.length) {
    const remainderOrder = items.map((item, index) => ({ index, remainder: item.count * 1000 / rated.length - tenths[index] })).sort((a, b) => b.remainder - a.remainder);
    const remaining = 1000 - tenths.reduce((sum, value) => sum + value, 0);
    for (let index = 0; index < remaining; index++) tenths[remainderOrder[index].index]++;
  }
  return {
    id,
    title,
    applicableCount: rows.length,
    ratedCount: rated.length,
    pendingCount: rows.length - rated.length,
    coverage: rows.length ? rated.length / rows.length : null,
    sampleState: rated.length >= 20 ? "ESTABLISHED" : "OBSERVING",
    items: items.map((item, index) => ({ ...item, percentage: rated.length ? tenths[index] / 10 : null })),
  };
}

export function buildQualityTagAnalysis(cycles = [], reviews = {}) {
  const profitCycles = cycles.filter((cycle) => exitQualityGroup(cycle) === "PROFIT_EXIT");
  const stopCycles = cycles.filter((cycle) => exitQualityGroup(cycle) === "STOP_EXIT");
  const entry = buildGroup("ENTRY", "買入點", cycles, reviews, "entryQualityTag", ENTRY_QUALITY_TAGS);
  const profitExit = buildGroup("PROFIT_EXIT", "獲利離場點", profitCycles, reviews, "exitQualityTag", PROFIT_EXIT_QUALITY_TAGS);
  const stopExit = buildGroup("STOP_EXIT", "止損離場點", stopCycles, reviews, "exitQualityTag", STOP_EXIT_QUALITY_TAGS);
  const fullyRatedCount = cycles.filter((cycle) => normalizeEntryQualityTag(reviews?.[cycle.id]?.entryQualityTag) && normalizeExitQualityTag(reviews?.[cycle.id]?.exitQualityTag)).length;
  return { entry, profitExit, stopExit, fullyRatedCount, total: cycles.length, completeCoverage: cycles.length ? fullyRatedCount / cycles.length : null };
}
