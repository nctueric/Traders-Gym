# 交易帳戶與交割記帳

新增交易以市場決定成交原幣，帳戶的 currency 僅作新交易預設交割幣別。同一帳戶可以保存 TWD 與 USD 現金。既有帳戶 ID、成交與資金紀錄不遷移、不回填虛構換匯。

## 資料契約

- fills[].settlement.version = 1，fillId 與原成交 ID 相同；保存 currency、total（含費用的扣款／入帳絕對值）、mode、rate（1 USD = TWD）、rateDate、forDate、source、feeCurrency、feeAmount、nativeFee、includesFee。
- fill.fee 維持成交原幣供 FIFO／損益計算；原始手續費在 settlement 保存。AUTO 使用來源快照，RATE 為手動匯率，TOTAL 以實際總額反推跨幣別匯率。
- 不新增 cashActivities 以免重扣。現金由 fillCashFlow 統一取交割金額，無 settlement 的舊成交沿用原幣成交額與費用。
- 十進位有理數計算中途不取整，最終 TWD 取整數、USD 取小數兩位。自動匯率必須對應成交日期；歷史查詢只接受當日或之前十四日內有效原始收盤價。當日報價最長七日並揭露來源時間；無資料須手動填寫。
- 新資料沿用既有 fills payload_json 與 JSON 匯出，不新增 D1 表。修改成交替換原交割資料，歷程保留 before/after，刪除成交自然移除其現金影響。
- simpleEntryDraft.formatVersion = 2；rows 增加 accountId/date/settlement。舊草稿以 batch.accountId/date 回退。共用日期手動套用與逐筆日期均不被市場切換覆寫。
- accounts 可新增 multiCurrency/disabled；settings.entryAccounts 以 TWD/USD 儲存新建倉預設帳戶 ID。不提供實體帳戶刪除，持倉非零時不得停用。

## 使用界線

「成交即交割」僅為帳本記帳，不執行真實換匯，也不模擬券商實際交割日。自動換算標示參考值；欲對帳應輸入實際交割總額。股票原幣損益與交割現金保持分離。

## 驗證

新增 tests/trade-settlement.test.mjs 覆蓋十進位取整、正反向匯率、買賣與不同費用幣別、實際總額、缺匯率、日期快照、混合批次、重送、帳戶停用、修改成交與正規化儲存相容性。回歸測試保留原帳本 FIFO 與現金契約。
