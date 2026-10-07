# 訪客真實市場資料本機驗收

驗收日期：2026-10-07；專案 v2.5.0。此工作只完成本機實作與驗收，未部署或遷移帳本。

## 實作契約

會員及訪客共用 Yahoo 行情適配層。匿名 GET `/api/market/quotes`、`/api/market/history` 不讀帳號，訪客轉送移除 cookie／session headers；交易、復盤與編輯只留於每個 runtime 的記憶體。既有會員 API 仍要求登入。

公開入口每批 50 標的、每段 400 日；客戶端分段取得歷史。上游並行最多 3 筆，含排隊與備援供應商主機的總逾時 10 秒。Cloudflare `MARKET_RATE_LIMITER` 使用 120 requests／60s；限流先於快取，共用 IP 共用額度。429 保留既有資料並遵守 Retry-After。成功報價／含今日日線快取 15 秒，已完成區間日線 30 分鐘；價格口徑分開快取，快取錯誤可直接讀取上游。

示範成交由最近一年有效且已完成日線產生，AAPL 長倉部分減碼及未平倉、MSFT 長空閉環、2330 台股未平倉。成交價是原始收盤價，每個初始部位名目預算 USD 5,000，台股使用成交日可用的真實匯率換算。USD 50,000 是明示的示範期初本金；未模擬成本，不自動產生股息、策略或指派。QQQ／SPY 績效採調整後收盤價。缺資料略過相關範例並提示；缺行情或匯率的完整總額顯示「—」。

現在時間可注入，表單當下取時，跨日及返回頁面更新。成交保留市場交易日；複盤成交標記及持有區間優先使用 tradeDate，避免美股收盤被台北時區移至隔日。既有統計週期口徑保留。

## 驗證結果

| 驗證 | 結果 |
| --- | --- |
| npm test | 454／454 通過 |
| npm run lint | 通過，無警告 |
| npx tsc --noEmit | 通過 |
| npm run build | 通過 |
| Wrangler deploy --dry-run | 通過，含 MARKET_RATE_LIMITER 綁定；沒有正式部署 |
| 真實行情本機抽查 | 9 筆成交／3 閉環／2 部位；逐筆原始收盤價符合來源，資料品質無錯誤 |
| 匿名隔離 HTTP 抽查 | 5 個私人 API 拒絕；NVDA 可查詢；過長區間 400；快取命中 200 |
| 桌面 1440×1000 | 簡易及完整登錄、切頁保留、持倉、績效、閉環 K 線、重新載入與重置 |
| 手機 390×844 | 持倉、導覽、複盤成交日期核對；頁面沒有水平溢出 |

桌面新增 NVDA 1 股後，切頁仍為 10 筆成交／3 部位；重新載入回到 9 筆／2 部位。行情更新保留帳本。自動測試另驗證兩份訪客 runtime 隔離、帶會員憑證的訪客市場請求會移除憑證、取消／重試／429／缺資料／缺報價時間／DST，以及原始和調整價格一致性。這次未使用真實會員身分登入或寫入私人帳本。

## 證據與重跑

- [HTTP 抽查](acceptance/guest-market-20261007/http.json)
- [完整測試](acceptance/guest-market-20261007/tests.log)
- [建置](acceptance/guest-market-20261007/build.log)
- [部署 dry-run](acceptance/guest-market-20261007/dry-run.log)
- [桌面畫面](acceptance/guest-market-20261007/desktop.png)
- [手機畫面](acceptance/guest-market-20261007/mobile.png)
- 固定夾具：`tests/fixtures/market/sources.json` 記錄 Yahoo 原始回應 URL、取得時間及 SHA-256；自動測試不依賴每日市場價格。

本機啟動使用隔離資料目錄：`LOCAL_RECORD_DIRECTORY=/tmp/tradergym-guest-acceptance LOCAL_MAIL_PREVIEW=true npm run dev -- --port 3107`。另執行 `node scripts/verify-guest-local.mjs http://127.0.0.1:3107` 可重跑匿名及來源價格核對；腳本只接受 localhost 且不寫入帳本。

Cloudflare 正式發布需使用生成設定中的 Rate Limiting binding。這次 dry-run 驗證打包及綁定格式，沒有在正式 Cloudflare 環境量測跨節點節流。市場延遲、缺口及未知報價時間依供應商實際回應顯示，不生成替代行情。Yahoo 若無法提供必要資料，首次載入顯示可重試錯誤。
