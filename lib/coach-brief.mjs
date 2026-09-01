function byImpact(a, b) {
  return Number(b.metrics?.stopLossAmountUsd || b.metrics?.marketValueUsd || 0)
    - Number(a.metrics?.stopLossAmountUsd || a.metrics?.marketValueUsd || 0);
}

export function isCycleReviewPending(review = {}) {
  return !review.entryQualityTag
    || !review.exitQualityTag
    || !String(review.exitReason || "").trim()
    || !String(review.reflection || "").trim();
}

function dataItem({ issues, qualityPct, storageBlocked }) {
  if (storageBlocked) {
    return {
      id: "data:storage",
      kind: "DATA",
      confidence: "FACT",
      title: "先保全尚未同步的交易紀錄",
      reason: "目前的儲存狀態需要處理，繼續編輯前應先確認版本或匯出備份。",
      evidenceRefs: ["帳號儲存狀態"],
      nextAction: { label: "前往資料檢查", target: "tests" },
    };
  }
  const issue = [...issues].sort((a, b) => (a.level === "error" ? -1 : 1) - (b.level === "error" ? -1 : 1))[0];
  if (!issue && qualityPct >= 100) return null;
  return {
    id: `data:${issue?.code || "quality"}`,
    kind: "DATA",
    confidence: "FACT",
    title: issue?.level === "error" ? "先修正會影響計算的資料" : "補齊資料後再判讀結果",
    reason: issue?.message || `目前資料完整度 ${qualityPct}%，缺漏欄位不會由系統推測補造。`,
    evidenceRefs: [issue?.code || `資料完整度 ${qualityPct}%`],
    nextAction: { label: "查看資料檢查", target: "tests" },
  };
}

function riskItem(positionRows) {
  const breached = positionRows.filter((row) => row.metrics?.stopBreached).sort(byImpact)[0];
  if (breached) {
    const { position, plan, metrics } = breached;
    return {
      id: `risk:breach:${position.id}`,
      kind: "RISK",
      confidence: "FACT",
      title: `${position.symbol} 已越過停損計畫`,
      reason: "目前行情已觸及你事先設定的風險界線；系統只提示，不替你下單。",
      evidenceRefs: [
        `停損 ${plan.stopLoss} ${position.currency}`,
        metrics.stopLossAmountUsd == null ? "風險金額待匯率" : `原始停損風險 USD ${metrics.stopLossAmountUsd.toFixed(2)}`,
      ],
      nextAction: { label: "檢視持倉與計畫", target: "position", entityId: position.id },
    };
  }
  const missingStop = positionRows.filter((row) => !(Number(row.plan?.stopLoss) > 0)).sort(byImpact)[0];
  if (!missingStop) return null;
  const { position, metrics } = missingStop;
  return {
    id: `risk:missing-stop:${position.id}`,
    kind: "RISK",
    confidence: "FACT",
    title: `${position.symbol} 尚未設定停損`,
    reason: "沒有明確失效價格時，系統無法計算這筆部位的最大計畫風險。",
    evidenceRefs: [
      metrics.allocationPct == null ? "持倉占比待行情" : `占總資產 ${(metrics.allocationPct * 100).toFixed(1)}%`,
      `${position.quantity} 股・${position.direction === "SHORT" ? "空" : "多"}`,
    ],
    nextAction: { label: "設定風險界線", target: "position", entityId: position.id },
  };
}

function reviewOrBehaviorItem(cycles, reviews, findings) {
  const pending = [...cycles]
    .filter((cycle) => isCycleReviewPending(reviews[cycle.id] || {}))
    .sort((a, b) => String(b.closeAt).localeCompare(String(a.closeAt)))[0];
  if (pending) {
    const review = reviews[pending.id] || {};
    const missing = [
      !review.entryQualityTag && "進場判斷",
      !review.exitQualityTag && "出場判斷",
      !String(review.exitReason || "").trim() && "原因",
      !String(review.reflection || "").trim() && "改善實驗",
    ].filter(Boolean);
    return {
      id: `review:${pending.id}`,
      kind: "REVIEW",
      confidence: "FACT",
      title: `完成 ${pending.symbol} 的交易復盤`,
      reason: `還缺少${missing.join("、")}；補完後才能把結果轉成下一筆可執行的規則。`,
      evidenceRefs: [`平倉 ${String(pending.closeAt || "").slice(0, 10)}`, `損益 ${Number(pending.pnl || 0).toFixed(2)} ${pending.currency}`],
      nextAction: { label: "開始復盤", target: "cycle", entityId: pending.id },
    };
  }
  const finding = findings[0];
  if (!finding) return null;
  return {
    id: `behavior:${finding.type}`,
    kind: "BEHAVIOR",
    confidence: finding.sampleCount >= 5 ? "PATTERN" : "OBSERVATION",
    title: finding.title,
    reason: finding.description,
    evidenceRefs: [`${finding.sampleCount} 筆樣本`, finding.impactUsd > 0 ? `估計影響 USD ${finding.impactUsd.toFixed(2)}` : finding.trend],
    nextAction: { label: "查看行為證據", target: "training", entityId: finding.evidenceCycleIds?.[0] },
  };
}

export function buildCoachBrief({ issues = [], qualityPct = 100, storageBlocked = false, positionRows = [], cycles = [], reviews = {}, findings = [] } = {}) {
  const candidates = [
    dataItem({ issues, qualityPct, storageBlocked }),
    riskItem(positionRows),
    reviewOrBehaviorItem(cycles, reviews, findings),
  ].filter(Boolean);
  if (candidates.length) return candidates.slice(0, 3);
  return [{
    id: "positive:clear",
    kind: "POSITIVE",
    confidence: "FACT",
    title: "今天沒有需要立刻處理的風險",
    reason: "資料、持倉計畫與交易復盤目前都沒有待辦。可記錄新交易，或回看近期表現。",
    evidenceRefs: ["資料檢查通過", "持倉均有風險界線", "閉環復盤已完成"],
    nextAction: { label: "查看近期績效", target: "performance" },
  }];
}
