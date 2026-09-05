# Cloudflare 發布閘門

更新：2026-09-05。必須逐步通過，不能以本機 build 通過代表正式發布驗收完成。

## 1. npm 安裝與建置設定：本機驗證通過、雲端設定讀回通過

- packageManager 指定 npm@10.9.2；新增 .node-version（22）。
- 移除 pnpm-workspace.yaml 與 pnpm-lock.yaml，保留 npm package-lock.json。原始設定可由 main 的 Git 歷史還原。
- GitHub CI 新增 TypeScript 檢查。
- Cloudflare production build_command 已更新為 npm ci && npm run build。
- Cloudflare build variables：SKIP_DEPENDENCY_INSTALL=1、NODE_VERSION=22；更新後以 GET 讀回核對一致。
- 隔離目錄乾淨安裝通過；242 項測試、lint、TypeScript 與正式 build 全部通過（本機 Node 24.18.0）。
- 尚未觸發遠端 build；正式 Node 22 / Linux 管線驗證留待發布閘門。停用中的 preview 設定未變動。

## 2. 正式 D1：建立與查詢驗證通過

- 名称：traders-gym
- UUID：4c8fb415-7edd-4fc0-bced-b9b4d7a13e2f
- 區域：APAC
- 建立後以 GET 讀回資訊，SELECT 1 AS ready 回傳 ready=1。
- 尚無應用資料表；migration 與資料匯入依順序在第 7 步執行。

## 3. 私有 R2：等待 Dashboard 登入與啟用

- 帳號 API 回覆 10042：Please enable R2 through the Cloudflare Dashboard.
- 已開啟 R2 overview，Dashboard 導向登入頁，瀏覽器尚未完成登入。
- 尚未建立 bucket，尚未上傳私人快照。
- 待登入與啟用後建立 traders-gym-snapshots，確認公開網址關閉，再做隔離測試物件寫入、讀取及雜湊驗證。

## 後續未執行

4. Google 正式 Web Client ID。
5. 正式 bindings、環境變數與部署設定。
6. GitHub 功能分支推送、CI、合併與候選版本驗證。
7. Migration、既有快照匯入及 SHA-256 / 版本核對。
8. 正式三種使用者登入與儲存驗收，驗證後發布。

目前 GitHub main 不可標示為可公開發布；Google 登入、正式資料與雲端部署驗收未完成。
本紀錄對應目前共用 D1 + 使用者隔離 JSON / 私有 R2 實作，尚未實作每客戶獨立 D1。
