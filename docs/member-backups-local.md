# 會員單一帳本、每週後台備份與 500 組閉環限制

2026-10-07 完成本機實作與隔離驗收。正式 D1 migration、Worker 發布及 GitHub 更新尚未執行。

## 現行契約

一般會員只看到一份正式雲端帳本，可更名、登錄、複盤、匯入及匯出。會員介面與私人帳本 API 不包含後台每週備份資訊。管理員保留多帳本，訪客維持當次記憶體練習。

每位一般會員最多 500 組已完成交易閉環，以正式 FIFO 閉環引擎的結果為準，分批成交不按成交筆數計算，未平倉部位不列入已完成閉環。新增、修改、JSON／CSV 匯入的最終雲端提交統一檢查；超限回傳 422，不寫入快照或增加版本。既有超額資料不刪除，允許複盤、同數量修改與減少閉環，禁止再增加。管理員不受此限制，還原不截斷歷史資料。

## 後台備份與還原

固定週五 `America/New_York` 16:00；休市與提前收盤不改時間，夏令時間自動換算。每分鐘排程檢查，週末可補執行；已建立的失敗工作可跨日重試。每個會員／紐約週五日期只能建立一個工作，來源在建立工作時固定為最新已提交版本。記錄預定、取得及完成時間，不能保證 Cron 精確在整秒執行。若整個週五收盤後至週末都未執行，下一週不会偽造上週快照。

D1 保存工作、來源引用、租約與最新備份指標；R2 保存獨立快照。來源與複本均經 SHA-256 校驗，新備份確認成功才原子替換最新指標。每次最多處理五個工作，單次 R2 操作逾時十秒，失败等待重試，舊成功備份保留。最新備份、未完成工作的來源與候選物件受垃圾清理保護；被替換的備份透過既有持久 GC 佇列移除。只保留一份成功每週備份，現有七日短期版本歷史不變。

後台「會員備份」提供搜尋、最後成功時間、來源版本、失敗原因、預覽及確認還原。還原保留主帳本 ID，建立新版本並同交易更新首頁摘要；提交時驗證管理員工作階段、目標歸屬、最新備份識別及預期主帳本版本。並行更新回傳 409，舊會員頁面不能覆蓋還原結果。另留存管理員、目標會員、來源備份、前後版本、時間及結果。

## API 與 migration

- `0012_safe_smasher.sql`：新增主帳本綁定、備份指標、排程工作、還原事件及帳本封存欄位；只新增結構，不批次改寫帳本。
- `POST /api/admin/member-ledgers/activate`：管理員準備既有會員的主帳本對應，以有效的目前選定帳本優先，否則取最近更新的未刪除帳本，無可用帳本才建立空帳本。其他帳本封存，保留原 ID、版本、內容與物件。
- `GET /api/admin/member-backups`：管理員清單；指定 `userId` 取得已校驗還原預覽；`action=events` 取得還原紀錄；`action=archives` 列出封存帳本，`action=archive-download&accountId=…` 匯出完整 JSON。
- `POST /api/admin/member-backups`：`action=restore`、`userId`、預覽取得的 `backupId` 及 `baseVersion`。會員及匿名請求拒絕。
- 原帳本與匯入匯出資料格式不變，會員帳本列表另回傳 `capabilities.multipleLedgers=false` 控制介面。

## 驗收紀錄

- 完整 488 項測試通過，Lint、TypeScript、建置與部署 dry-run 通過。
- 本機 Miniflare D1／R2：真實儲存適配層完成獨立備份、修改及還原。[結果](acceptance/member-backups/local.json)
- 臨時 Cloudflare APAC D1／R2：匿名／會員越權拒絕、單帳本限制、週備份、重複排程跳過、409 衝突、還原及首頁一致、舊備份回收、第 501 組拒絕與稽核紀錄通過。[結果](acceptance/member-backups/cloudflare.json)
- 桌面及 390×844 手機尺寸：會員只顯示一份帳本、沒有週備份入口；管理員預覽、确认及成功還原通過，頁面無橫向溢出。[會員桌面](acceptance/member-backups/member-desktop.png)、[會員手機](acceptance/member-backups/member-mobile.png)、[管理員桌面](acceptance/member-backups/admin-desktop.png)、[管理員手機](acceptance/member-backups/admin-mobile.png)
- 臨時 Worker、D1、R2 已移除，僅使用合成資料，未讀取或更改正式帳本。[清理紀錄](acceptance/member-backups/cleanup.json)
- 隔離雲端透過受保護的測試入口注入排程時間執行相同備份服務；未等待真實週五 Cron，也不代表實機手機網路驗收。

## 正式啟用順序

1. 確認既有 `0011_ledger_home_views.sql` 已準備，备份正式 D1／R2，再套用 0012；正式發布狀態見下方 2026-10-07 紀錄。
2. 發布包含新服務但 `MEMBER_SINGLE_LEDGER=false`、`MEMBER_WEEKLY_BACKUPS=false` 的版本。
3. 管理員執行主帳本準備入口，核對 ID、版本、內容不變及封存清單；完成首頁摘要回填。
4. 啟用 `MEMBER_SINGLE_LEDGER=true`，核對會員介面及舊客戶端限制；再啟用 `MEMBER_WEEKLY_BACKUPS=true` 與每分鐘 Cron。
5. 核對第一次成功備份及後台狀態。回復時停用排程及單帳本限制，保留綁定、備份與封存資料；封存帳本不會自動重新開放。

本機驗收腳本：`scripts/verify-member-backups-local.mjs`。隔離雲端驗收腳本固定使用已刪除的 QA 網址；不得改為正式網域或正式帳本工作階段執行。


## 2026-10-07 正式發布

已正式發布至 https://tradergym.app，Worker 版本 `2907699c-fd31-4107-b9a8-5808c103c5f3`。0011／0012 已套用；三份既有帳本已備份，ID、版本、R2 指標與 SHA-256 內容校驗碼均保持不變。回填三份首頁摘要，建立一位一般會員的主帳本指標。已啟用 `HOME_VIEW_READS`、`MEMBER_SINGLE_LEDGER`、`MEMBER_WEEKLY_BACKUPS`，登入設定及原有 secret 維持。

正式網站登入／訪客頁、真實行情、USD／TWD 切換及私人 API 的匿名拒絕檢查通過。備份工作排程每分鐘檢查紐約週五 16:00，到期才執行；首次預定台灣時間 2026-10-10 04:00（夏令時間）。目前尚無每週備份，未提前以未來日期建立正式備份，亦未對真實會員執行還原。管理員還原、500／501 閉環及會員隔離的完整操作驗收沿用上述隔離雲端結果；本次沒有已登入的正式會員工作階段，因此未重新量測正式登入摘要 P95。

[正式 HTTP 檢查](acceptance/member-backups/production-http.json)、[發布紀錄](acceptance/member-backups/production.json)。

正式發布後發現 Node 22 SQLite 對相關子查詢 ORDER BY 的相容性差異，已改用明確選定帳本查詢與更新時間 fallback，仍保持一次 D1 讀取。Node 22 的 24 項相關測試及 488 項完整測試皆通過；正式 D1 已唯讀確認查詢可執行且無效工作階段被拒絕。修正版來源 commit 為 `c30e313`。

修正版 GitHub CI 已通過完整測試、Lint、TypeScript 與建置：[執行紀錄](https://github.com/nctueric/Traders-Gym/actions/runs/37594037958)。啟用後再次觀察到一份帳本透過正式手動儲存正常增加版本，最新 R2 快照校驗通過、三份首頁摘要皆對應目前版本；發布前備份保留於私人目錄。來源不變的核對描述指發布回填與啟用階段，不代表阻止後續會員編輯。
