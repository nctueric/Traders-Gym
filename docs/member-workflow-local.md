# TraderGym 會員流程：本機驗收交付

本輪為本機隔離版本，未發布 Cloudflare，未執行正式 D1 遷移，也未變更原始帳本。

## 開啟與測試資料

- 登入：<http://localhost:3000/login>
- 免登入體驗：<http://localhost:3000/demo>
- 申請／查詢：<http://localhost:3000/apply>
- 已登入會員的設定：<http://localhost:3000/settings>
- 啟動：`npm run dev:acceptance`。固定使用 `data/private/member-workflow-acceptance`，郵件只寫入該目錄的 `mail-preview`，不寄出。
- 一般會員：`acceptance@example.com`；測試管理者：`admin-acceptance@example.com`。
- 本次隔離測試密碼：`TraderGym-test-only-2026`。它僅供本機合成帳號，不是擁有者或正式站密碼。
- 新環境先啟動驗收站，再執行 `ACCEPTANCE_PASSWORD='自行設定至少12字元' node scripts/seed-member-acceptance.mjs`。腳本只操作固定的隔離資料庫，不覆寫已存在的密碼或帳本。

## 實作範圍

- TraderGym TG 訓練軌跡 SVG：`public/brand` 完整字標、獨立圖示及深淺底版本；主 UI 與 favicon 共用幾何構成。
- Google／Mail 單欄登入、Email 申請驗證、核准後設定密碼、忘記密碼、帳號連結。新密碼至少 12 字元；單次連結 15 分鐘，資料庫僅存 token 雜湊。
- 密碼重設撤銷既有工作階段。相同 Email 不自動合併 Google 帳號；既有擁有者 ID、所有權及舊密碼相容路徑保留。
- `/demo` 使用示範買賣、真實行情／匯率、實際日期及記憶體暫存；沒有私人匯入匯出、管理或雲端寫入，重整或離開後重置。
- 會員帳本新增、改名、切換、回收筒及還原。零帳本不自動重建；已刪除帳本拒絕讀寫，舊分頁寫入收到 410。
- 資金活動新增、編輯、刪除確認及撤銷。共用表單處理 USD／TWD、當地時間轉 UTC、類型決定增減；一般金額必須大於零，期初校正可為零或負數。
- 資金與計畫明確操作立即寫入雲端；草稿停止輸入 1 秒後儲存，不寫入本機備份。首頁標示交易損益，與包含股息等收益的整體績效區分。

## 驗收證據

- 最終 406 項測試全部通過；Lint、TypeScript、正式建置及 `git diff --check` 通過。
- 單元／整合測試涵蓋 Email 驗證、密碼與 session、邀請撤銷、Email／Google 身分衝突、申請版本、帳本隔離／回收／還原、舊請求、已填資料保留、跨幣別資金與 FIFO 不變。
- 另以正在執行的本機服務完成 20 項 HTTP 斷言：郵件預覽 → 驗證 → 申請 → 核准 → 密碼啟用 → 登入 → 新帳本 → 入金保存 → 回收 → 舊請求拒絕 → 零帳本 → 還原 → 重新登入恢復完整快照。報告：`.impeccable/review/http-acceptance.json`。
- 瀏覽器曾完成真實 Mail 登入、建立帳本、會員入金保存／重新載入、訪客入金與切頁保留及不同訪客副本隔離。後續原生確認框阻塞輸入，剩餘點按／鍵盤／取消／還原互動仍需接續驗收；不能以 HTTP 測試代替此項。
- 桌面 1440px、1280px 與手機 390px 截圖位於 `.impeccable/review`。資金及帳本對話框另用只含合成資料的 UI fixture 驗證；fixture 沿用正式元件及 CSS，以強制啟用深色媒體規則檢查深色樣式，並非宣稱已測試 OS 主題切換。
- UI fixture：`MEMBER_UI_FIXTURE=true node tests/serve-ui-fixture.mjs`，啟動後使用輸出的隨機本機網址。`?scenario=cash-invalid-dark` 驗證負數不反轉預覽；`ledger`／`ledger-dark` 驗證帳本管理。

## 正式上線前仍需完成

1. 在 Resend 驗證 `tradergym.app`、設定 Cloudflare `RESEND_API_KEY`；寄件者為 `TraderGym <no-reply@tradergym.app>`。本輪未提供或使用正式寄信金鑰。
2. 使用實際收件匣完成驗證、啟用、重設、過期、重新寄送與失敗驗收。審核結果維持網站查詢，不增加通知信。
3. 使用一般瀏覽器完成真實 Google 憑證的登入及連結；目前新流程中的身分競態與權限測試使用隔離憑證。
4. 完成剩餘瀏覽器互動驗收。UI 檢查工具的 detector 引擎未安裝，未取得自動 detector 結果；已有獨立畫面／程式審查。
5. 正式發布另行授權後，備份最新資料，先套用 `0008_member_workflow.sql` 再部署程式；核對原擁有者與帳本。不得拿本機 fixture、舊快照或示範資料覆蓋正式帳本。

回復程式版本時保留新增資料表及最新帳本；不要移除遷移或以舊資料回灌。

## 暫時開放 Google 登入

本機 `.env.local` 已啟用 `OPEN_GOOGLE_LOGIN=true`。新 Google 身分免申請即可登入，既有停用、撤銷、保留擁有者及同信箱不同身分限制仍有效。設回 `false` 並重啟即可恢復新會員申請制；已建立的會員不會因此停用。Google 身分必須通過簽章、受眾、期限、CSRF 及已驗證信箱檢查，帳號仍以 `sub` 識別。

後台預設進入帳號管理，按會員顯示最近登入、有效工作階段數及帳本概況；每份帳本可查看名稱、版本、最後儲存與回收狀態。不提供其他會員的交易內容。

正式設定產生器支援 `--open-google-login=true`（預設 false）；本輪未部署雲端。408 項測試涵蓋開放／關閉、停用／撤銷、帳號隔離與多帳本彙整。

## 2026-10-05 正式發布覆核

使用者後續明確要求部署 Cloudflare。本次完成 `0008_member_workflow.sql` 遷移，發布版本 `1278f776-6b5a-422b-8d9c-26c149d9c81c`，正式 `OPEN_GOOGLE_LOGIN=true`。保留既有登入密碼 Secret 與正式 D1/R2 綁定。

發布前備份於 `data/private/cloud-before-member-20261005/`，含 D1 匯出及兩份最新完整帳本；發布後相同目錄保存核對報告。標準歷史帳本 v476（569 筆成交、64 筆資金活動）、另一份帳本 v31（566 筆成交、64 筆資金活動），發布前後完整 dataset SHA-256 相同。本機帳本未上傳覆蓋雲端。

正式登入頁／訪客頁、Mail 登入、管理後台帳本彙整、未登入私人 API 拒絕及 www 保留路徑參數的轉址已通過 HTTP 驗證。真實 Google 瀏覽器登入仍需使用者驗收；未以模擬身分在正式站建立會員。Resend Secret 尚未提供，寄信相關的新 Mail 設定／重設功能待設定；既有 Mail 密碼登入維持有效。

2026-10-07 儲存及計價契約已更新，舊版驗收紀錄不代表目前的儲存模式。現行規格及驗收：[雲端帳本與計價](cloud-valuation-local.md)。
