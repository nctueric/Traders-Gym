# 帳號系統驗收紀錄

日期：2026-09-05。範圍：功能分支、本機隔離資料庫、測試用 R2 adapter 與實際 Workers 建置；未變更正式部署。

- 原有 232 項測試與新增 10 組帳號／安全測試皆通過（242 項）。
- ESLint、TypeScript 與正式 Vinext／Workers 建置通過。
- 瀏覽器實測：擁有者開啟後台、新增邀請、儲存狀態與操作紀錄；一般成員沒有後台入口，直接開啟 `/admin` 導向拒絕頁。
- 桌面及手機卡片版面已檢查；測試使用隔離身分，沒有寄出邀請信，也沒有寫入正式交易資料。
- API 測試涵蓋未登入、未受邀、owner 保護、跨帳號 ID 竄改、session 到期與撤銷、CSRF／Origin、JWT 驗證、CAS、R2 寫入失敗及完整性校驗。
- 真實 Google 流程尚未驗收：使用者尚未建立 Web Client ID；Cloudflare 正式資源和最終網域尚未設定。

## 真實資料還原演練

從本機封存快照在臨時目錄建立帳本，驗證 Google 擁有者綁定後完整 JSON 與版本一致。實際版本為 1208，緊湊大小為 3,341,417 bytes。

- 封存檔 SHA-256：`aea83055841d18332de4f97aa85877ab6cf1f3244fa6078ad71a9610e1c7e859`
- 純資料 JSON SHA-256：`4ec3c7c5811912367274421bf0a7285f41865277df1f42d6b0903c1168fd9d6d`
- 演練結果：`sameDataset=true`、`sameVersion=true`、`productionModified=false`。

私人 JSON 與帳號 SQLite 均不在 Git 追蹤範圍。Cloudflare 的跨帳號搬移與正式 Google 登入是上線前必須完成的項目，不能以本機測試取代。
