type EquityComposition = {
  totalUsd: number | null;
  cashUsd: number | null;
  grossPositionValueUsd: number | null;
  exposurePct: number | null;
  hasShortPositions: boolean;
};

const usd = (value: number | null) => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", currencyDisplay: "code", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);

export function EquityBreakdown({ equity, compact = false }: { equity: EquityComposition; compact?: boolean }) {
  return <div className="equity-breakdown">
    <dl aria-label="現金、持倉與曝險">
      <div><dt>現金水位</dt><dd className={equity.cashUsd != null && equity.cashUsd < 0 ? "negative" : ""}>{usd(equity.cashUsd)}</dd></div>
      <div><dt>持倉水位</dt><dd>{usd(equity.grossPositionValueUsd)}</dd></div>
      <div className="equity-exposure"><dt>曝險比率{!compact && <small>持倉／總資產</small>}</dt><dd>{equity.exposurePct == null ? "—" : `${(equity.exposurePct * 100).toFixed(1)}%`}</dd></div>
    </dl>
    {!compact && equity.hasShortPositions && <small className="equity-composition-note">持倉水位＝多單市值＋空單市值絕對值；總資產仍以現金＋多單－空單計算。</small>}
    {(equity.cashUsd == null || equity.grossPositionValueUsd == null || equity.totalUsd == null) && <small className="equity-composition-note">行情或匯率未齊，不顯示不完整的金額與曝險比率。</small>}
    {!compact && equity.totalUsd != null && equity.totalUsd <= 0 && <small className="equity-composition-note">總資產未大於零，曝險比率不適用。</small>}
  </div>;
}
