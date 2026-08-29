"use client";

import { memo, useMemo } from "react";
import { buildPositionLedger } from "@/lib/position-ledger.mjs";

export type PositionTransactionSource = {
  id: string; symbol: string; accountId: string; currency: string; direction: string; quantity: number;
  fills?: { id: string; timestamp: string; side: string; quantity: number; price: number; fee?: number; currency?: string; note?: string; splitRole?: string; originalFillId?: string }[];
};
const quantity = (value: number) => value.toLocaleString("zh-TW", { maximumFractionDigits: 8 });
const amount = (value: number, currency: string) => `${value.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${currency}`;

export const PositionTransactions = memo(function PositionTransactions({ position, accountName, onOpenChart }: {
  position: PositionTransactionSource;
  accountName: string;
  onOpenChart: (position: PositionTransactionSource, eventId?: string) => void;
}) {
  const ledger = useMemo(() => buildPositionLedger(position), [position]);
  return <section className="position-transactions" aria-label={`${position.symbol} 本輪交易紀錄`}>
    <div className="position-transactions-head">
      <div><h3>{position.symbol} 交易紀錄</h3><p>{accountName}・僅本輪持倉・最新成交在上</p></div>
      <p>建倉／加碼 {ledger.entryCount} 筆 · 減碼／回補 {ledger.reductionCount} 筆 · 目前 {quantity(position.quantity)} 股</p>
    </div>
    {!ledger.quantityMatches && <p className="position-ledger-warning" role="status">成交推算部位與目前持倉不一致，請至成交紀錄檢查來源；此處不自動調整帳務。</p>}
    {ledger.hasSameDay && <p className="position-ledger-note">相同時間的成交保留來源順序；部位變化依帳本順序計算，日K不代表盤中先後。</p>}
    {ledger.fillCount ? <table className="position-transactions-table">
      <caption className="sr-only">{position.symbol} 本輪成交明細，金額以原幣計價，成交金額不含手續費</caption>
      <thead><tr>{["日期（台北）", "買賣／動作", "數量", "成交價", "成交金額", "手續費", "成交後持倉", "備註／來源", "K 線"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{ledger.rows.map((row) => <tr key={row.id}>
        <td><time dateTime={row.timestamp} title={row.timestamp}>{row.date}</time>{row.sameDay && <small className="block">同日成交</small>}</td>
        <td><span className={`side ${row.side.toLowerCase()}`}>{row.side === "BUY" ? "買進" : "賣出"}</span><small className="block">{row.action}{row.splitRole ? "・反手拆分" : ""}</small></td>
        <td>{quantity(row.quantity)}</td><td>{amount(row.price, row.currency)}</td><td>{amount(row.notional, row.currency)}</td><td>{amount(row.fee, row.currency)}</td>
        <td>{quantity(row.beforeQuantity)} → <b>{quantity(row.afterQuantity)}</b> 股</td>
        <td className="position-fill-note">{row.note || "—"}{row.originalFillId && <small className="block">原始成交：{row.originalFillId}（本輪分攤數量與費用）</small>}</td>
        <td><button type="button" className="ghost" aria-label={`${position.symbol} ${row.date} ${row.action} ${quantity(row.quantity)} 股 K線`} onClick={() => onOpenChart(position, row.eventId)}>定位成交</button></td>
      </tr>)}</tbody>
    </table> : <p className="empty">沒有可用的原始成交明細，請檢查匯入資料；不以持倉數量補造交易。</p>}
    <p className="position-ledger-note">成交金額＝數量 × 成交價（未含費用）。剩餘成本沿用原帳本 FIFO；查看明細不更動現金、成本或總資產。</p>
  </section>;
});
