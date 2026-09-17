# Cloudflare 個人密碼試用部署紀錄

更新：2026-09-17。以已發布的 `v2.1.0`（`334d3cb3db0fea4206fdade9ffb13f9ec3517c6c`）為基準，開發分支 `feat/cloudflare-personal-trial`。不改寫既有標籤、不更新既有 Sites。

## 已完成

- 單一個人帳號 Email／密碼登入，Google 入口停用。密碼以隨機 32-byte salt 的 PBKDF2-SHA256 驗證值保存在 Worker Secret；程式碼、前端資源及本文件不含密碼。
- 12 小時 HttpOnly／Secure／SameSite=Lax session；登出後失效。密碼驗證值更新會使舊 session 失效。
- 同來源檢查、每 IP 每 15 分鐘最多 10 次登入嘗試、整站每 15 分鐘最多 100 次；不同帳號錯誤回覆一致。
- 個人密碼身分以獨立命名空間識別，不綁定 Google／Sites 舊帳本，也不自動匯入真實交易資料。
- 保留歷史版本、下載與還原；個人模式不提供 Google 帳號管理。
- 登入畫面及隱私說明更新，保留 V2.0／V2.1 的交易工作台。

## 線上資源

| 項目 | 值／狀態 |
| --- | --- |
| Cloudflare account | `3d09d501e6a0115eb8538e8f9f197a48` |
| Worker | `traders-gym`，原有 dashboard placeholder 尚未換成新版 |
| D1 | `traders-gym`／`4c8fb415-7edd-4fc0-bced-b9b4d7a13e2f` |
| R2 | `traders-gym-snapshots`，APAC／Standard，r2.dev 公開存取停用 |
| 登入 email | `nctueric@gmail.com` |
| Secret | `PERSONAL_PASSWORD_HASH` 已設至既有 Worker |
| 預期網址 | `https://traders-gym.nctueric.workers.dev`；尚未以新版實際發布驗證 |

線上 D1 原先為空白，2026-09-17 07:25 UTC 已依序套用 `0000`–`0005`，並記錄至標準 `d1_migrations`。37 個 SQL 敘述成功，外鍵檢查無錯，交易帳本筆數仍為 0。

R2 原先沒有 bucket，已建立上述私人桶。07:28 UTC 寫入 1,920,083-byte 合成 JSON，讀回內容逐字相等；兩個 `qa/` 測試物件已刪除，確認該前綴沒有殘留。這是服務 API 測試，不能代替正式 Worker binding 端到端驗收。

## 驗證結果

| 層級 | 結果 |
| --- | --- |
| 自動測試 | 250／250 通過 |
| ESLint、TypeScript | 通過 |
| 正式建置、Wrangler dry-run | 通過；總壓縮上傳約 315 KiB |
| 本機 workerd 發布包 | 密碼登入、未登入拒絕、跨站登入／寫入拒絕、其他帳本拒絕、Google 停用通過 |
| 本機 D1/R2 binding | 小型／1.9 MB 大型快照 SHA-256 讀回一致、舊版本寫入 409、歷史還原建立新版本通過 |
| 本機復原／登出 | 恢復原始空白帳本、登出後讀取 401 通過 |
| 瀏覽器 | 登入表單進入工作台、讀取帳本、自動儲存成功；未見 console error |
| 線上 D1/R2 | 遷移、外鍵、私人設定、R2 服務讀寫通過 |
| 正式 Worker | 待部署後驗證；不可標記個人完整試用完成 |

建置設定沿用專案已測試的 compatibility date；不可改成超出已安裝 workerd 支援日期的當日日期。

## 尚待完成的部署步驟

Wrangler 尚未登入；兩次官方 OAuth listener 等待逾時。這與 D1/R2 服務啟用無關，也不是審查模型容量問題。需使用者在 Cloudflare 官方 OAuth 頁完成首次 CLI 授權。不要在聊天貼 API token。

1. 在專案目錄執行 `WRANGLER_LOG_PATH=.wrangler/wrangler.log ./node_modules/.bin/wrangler login --browser=false --scopes account:read user:read workers:write workers_scripts:write d1:write`，立即開啟該次新產生的網址，登入並 Allow。
2. 重建時執行 `npm run build`，然後執行：

   ```sh
   node scripts/prepare-cloudflare.mjs --account-id=3d09d501e6a0115eb8538e8f9f197a48 --database-id=4c8fb415-7edd-4fc0-bced-b9b4d7a13e2f --bucket=traders-gym-snapshots --personal-email=nctueric@gmail.com
   ```

3. 確認 config 只有個人模式 vars，沒有 `LOCAL_ACCOUNT_SERVICE`／`SITES_TRIAL_AUTH`／`GOOGLE_CLIENT_ID`。本機測試用 `dist/server/.dev.vars` 不發布，也不能用它覆蓋線上 Secret。
4. 確認線上遷移已套用及 Secret 名稱存在，再執行 `WRANGLER_LOG_PATH=.wrangler/wrangler.log ./node_modules/.bin/wrangler deploy --config dist/server/wrangler.cloudflare.json`，保存發布 version ID。
5. 在正式 HTTPS 網址執行 `scripts/verify-cloudflare-trial.mjs <url> <report.json>`，帳號密碼只從 stdin 傳入。此腳本只接受全新 v1 空白帳本，寫入合成大小資料後恢復原始內容，保留合成歷史紀錄供追溯；已開始使用的帳本會拒絕測試。若需重新測試，使用隔離環境，勿刪除現有帳本。
6. 驗證正式 D1 的 R2 指標、私有物件、登入 Cookie 與工作台頁面；最後交付已實測的網址。

## 使用與復原

- 正式 Cloudflare 帳本起始為空白。真實帳本來源尚未選定，不會擅自合併本機與舊 Sites 資料。
- 使用前可匯入經確認的完整 JSON 副本，並先下載備份。雲端版不會寫入電腦的 Obsidian 資料夾。
- 還原請透過歷史版本建立新版本；不覆寫歷史物件，不刪除 D1/R2 重建。
- 更新密碼時，用可信任本機程式計算加鹽驗證值，再更新 `PERSONAL_PASSWORD_HASH`。不要把明文密碼寫入 vars、原始碼或 commit。
- Google 登入、第二身分隔離驗收、手機／Safari、離線衝突與 7 天完整試用仍待進行。單人密碼模式不能當作多人正式營運驗收。
