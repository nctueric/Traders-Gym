# TraderGym 首頁摘要與淺色介面：實作及驗收

2026-10-07。本次修改在 v2.5.1 工作目錄完成。正式網站、正式 D1／R2、帳本 ID、版本與內容未改動；migration 0011 僅在本機及獨立 Cloudflare 測試 D1 執行。

## 已實作

- 新增 `ledger_home_views`，綁定帳本擁有者、來源版本、摘要格式、來源 SHA-256、R2 key 與估值時間。摘要沿用 FIFO 及正式資產引擎，保留原幣現金、資產、曝險金額、成本及損益；最多回傳 20 個持倉，總計涵蓋全部持倉。
- 完整儲存先寫入帶校驗碼的 R2 快照，再以同一個 D1 batch 更新帳本版本指標與摘要。摘要寫入失敗會回滾指標。CAS 失敗的請求不能覆蓋另一版本的摘要。建立帳本及重新命名／回收／還原等版本變動也走原子摘要更新；歷史快照還原沿用一般儲存流程。
- `GET /api/workspace/bootstrap` 一次 primary D1 查詢讀取有效登入、擁有權、偏好、目前帳本及匹配版本／object key 的摘要。保留停用、撤銷、切換工作階段、Email verifier 與個人密碼 verifier 檢查。這条讀取路徑不初始化帳本、不讀 R2，也不放入公共 CDN／KV。回應 `no-store`，大小超過 64 KiB 時放棄摘要並回到完整載入。
- 根頁直接 SSR 輸出唯讀摘要。背景僅下載一次完整帳本，由伺服器校驗 R2 SHA-256；版本不同時重新取得一致摘要，連續變動達三次則等待手動重試。取消、登入失效、逾時或校驗失敗皆不進入可寫狀態。驗證後將完整資料交給正式工作台，免第二次下載；初始化計算期間保留唯讀摘要，避免短暫退回載入畫面。
- 偏好隨 bootstrap 接手；舊配色轉移直接使用摘要／已取得的完整資料，取消額外的帳本下載。完整資料尚未就緒時，登錄、資金編輯及完整匯出停用並顯示準備或重試狀態。
- 缺行情、待確認資金幣別或必要匯率時，完整金額顯示「—」。摘要標示儲存時估值、來源及實際報價時間，不以取得時間冒充。歷史匯率不足時已實現損益保留缺口，背景正式績效資源完成後由完整工作台計算。
- 移除所有應用程式 CSS 的系統暗色分支，CSS 及 HTML 均設定 `color-scheme: light`。保留深綠行情列、品牌 SVG 與紅漲／綠漲偏好。產品及設計文件同步更新。

## 量測

後端 `Server-Timing` 分為 auth、d1、summary、serialize、total。Cloudflare 的時鐘解析度使短 CPU 段可能回報 0 ms，不能解讀成沒有 CPU 工作。瀏覽器用 buffered Element Timing 取得 SSR 資產文字繪製時間，另以 `tg-full-ledger-ready` 記錄完整工作台初始化完成；只含導航開始後的時間，不含輸入及提交密碼。

| 環境／量測 | 樣本 | P50 | P95 |
| --- | ---: | ---: | ---: |
| 獨立 Cloudflare，摘要後端處理 | 200 | 16 ms | **22 ms** |
| 同批 API，含本機到 Cloudflare 網路往返 | 200 | 111.7 ms | 124.0 ms |
| 隔離網站桌面 1440px，資產文字實際繪製 | 10 | 168 ms | 200 ms |
| 隔離網站手機尺寸 390px，資產文字實際繪製 | 10 | 156 ms | 220 ms |
| 隔離網站桌面，完整帳本可用 | 10 | 745 ms | 1,197 ms |
| 隔離網站手機尺寸，完整帳本可用 | 10 | 729 ms | 794 ms |

Cloudflare 使用獨立 APAC D1、R2 與完整 vinext 正式建置，請求經 SIN 節點。測試帳本為明確標識的合成夾具：7,521,633 bytes、574 筆成交、46,688 根日線。摘要 API 為 1,548 bytes，SSR HTML 13,351 bytes。讀取完整 R2 後逐欄核對原始夾具相同。匿名讀取及非 GET 操作被拒絕。

本機另用現有大型快照的隔離副本測試 200 次：7,652,675 bytes、574 筆成交、46,688 根日線，摘要約 4.5 KiB。私人成交及快照內容不納入驗收文件或 Git。精確本機數值見 JSON 紀錄。

首次登入的單次觀察：SSR 首次內容繪製約 304 ms，前端接手摘要約 724 ms，完整帳本可用約 2,304 ms；當時尚未加入資產文字 Element Timing，因此 304 ms 是 FCP，不是資產文字精確測量。後續上述表格改採資產文字精確量測。沒有宣稱整個登入流程已達 0.1 秒。

後端達到 P95 ≤100 ms；網路往返與瀏覽器首屏另行報告。手機是 viewport 走查，沒有冒充實體手機、限速行動網路或受控台灣電信環境。隔離合成夾具比真實變動行情更容易壓縮，因此背景下載時間不直接代表正式大型帳本。正式上線前仍須以真實台灣桌面／手機網路確認登入提交至首屏可見的端到端 P50／P95。單批第一筆耗時保存在紀錄中，並不等同強制全新 Worker 冷啟動。

## 驗證

473 項完整測試、Lint、TypeScript、建置及 Worker 部署 dry-run 已通過。新增涵蓋：USD／TWD 原幣與 FIFO 核對、多空持倉、缺行情及過期 FX、20 個持倉截斷、64 KiB、單次唯讀查詢、版本衝突及交易回滾、損壞摘要回退、回填 SHA 校驗及不改來源、摘要欄位損壞與錯誤擁有者綁定、擁有者／工作階段隔離、撤銷 Email／個人密碼 verifier、取消及校驗失敗、摘要版本改變、完整工作台不重複下載、固定淺色樣式。桌面與手機各 10 次線上走查皆只有一次完整帳本下載且無水平溢出。重複走查期間曾出現上游行情更新失敗，介面保留已儲存行情並標示待更新，沒有合成備援。量測後補上的摘要欄位防呆及接手期間保留摘要，已通過最終本機完整驗收；正式發布時再量測最終建置。

- [本機後端取樣](acceptance/home-speed/local-benchmark.json)
- [完整隔離 Cloudflare 取樣](acceptance/home-speed/cloudflare-benchmark.json)
- [隔離網站前端取樣](acceptance/home-speed/cloud-frontend.json)
- [本機開發前端早期取樣](acceptance/home-speed/frontend.json)：使用接手時間作保守上界，非 Element Timing。
- [桌面截圖](acceptance/home-speed/cloud-desktop.png)
- [手機截圖](acceptance/home-speed/cloud-mobile.png)

## 正式上線與回復順序

1. 備份正式 D1 schema，執行 `0011_ledger_home_views.sql`。此 migration 只新增摘要表及索引，不更新帳本。
2. 部署摘要寫入功能，保持 `HOME_VIEW_READS=false`。`scripts/prepare-cloudflare.mjs` 接受 `--home-view-reads=false|true`，預設關閉。
3. 擁有者登入後，同來源 POST `/api/admin/home-views/backfill`。每批最多 20 筆，只從已校驗 R2／原有 inline 來源建摘要；重複呼叫直到 `examined=0`。來源指標在處理中變動時跳過該筆並在下一批重建，不改帳本 ID、版本、完整內容或原始 key。任何缺快照或 SHA 不符立即停止，修復來源後再繼續。
4. 抽樣核對帳本及摘要原幣金額、FX 缺口、來源版本與 checksum，再開啟 `HOME_VIEW_READS=true`。正式台灣端到端驗收完成後安排正式發布。
5. 若有載入問題，設回 `HOME_VIEW_READS=false` 恢復既有完整載入；保留摘要寫入及新表。沒有批次重寫帳本或格式遷移。

獨立測試 Worker／D1／R2 只用來驗收，清理狀態記錄於 `acceptance/home-speed/cleanup.json`。其 URL 不是正式產品發布入口。測試腳本的固定測試名稱與 ID 不可用於正式部署。


## 2026-10-07 正式發布

已正式發布至 https://tradergym.app，Worker 版本 `2907699c-fd31-4107-b9a8-5808c103c5f3`。0011／0012 已套用；三份既有帳本已備份，ID、版本、R2 指標與 SHA-256 內容校驗碼均保持不變。回填三份首頁摘要，建立一位一般會員的主帳本指標。已啟用 `HOME_VIEW_READS`、`MEMBER_SINGLE_LEDGER`、`MEMBER_WEEKLY_BACKUPS`，登入設定及原有 secret 維持。

正式網站登入／訪客頁、真實行情、USD／TWD 切換及私人 API 的匿名拒絕檢查通過。備份工作排程每分鐘檢查紐約週五 16:00，到期才執行；首次預定台灣時間 2026-10-10 04:00（夏令時間）。目前尚無每週備份，未提前以未來日期建立正式備份，亦未對真實會員執行還原。管理員還原、500／501 閉環及會員隔離的完整操作驗收沿用上述隔離雲端結果；本次沒有已登入的正式會員工作階段，因此未重新量測正式登入摘要 P95。

[正式 HTTP 檢查](acceptance/member-backups/production-http.json)、[發布紀錄](acceptance/member-backups/production.json)。

正式發布後發現 Node 22 SQLite 對相關子查詢 ORDER BY 的相容性差異，已改用明確選定帳本查詢與更新時間 fallback，仍保持一次 D1 讀取。Node 22 的 24 項相關測試及 488 項完整測試皆通過；正式 D1 已唯讀確認查詢可執行且無效工作階段被拒絕。修正版來源 commit 為 `c30e313`。

修正版 GitHub CI 已通過完整測試、Lint、TypeScript 與建置：[執行紀錄](https://github.com/nctueric/Traders-Gym/actions/runs/37594037958)。啟用後再次觀察到一份帳本透過正式手動儲存正常增加版本，最新 R2 快照校驗通過、三份首頁摘要皆對應目前版本；發布前備份保留於私人目錄。來源不變的核對描述指發布回填與啟用階段，不代表阻止後續會員編輯。
