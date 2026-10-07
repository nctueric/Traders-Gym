# Google 帳號與 Cloudflare 上線手冊

> 2026-10-05 更新：本機 Google 綁定已由擁有者驗收；新版已發布至 `https://tradergym.app`，並保留 workers.dev。兩組 Client ID 已分別設定，正式 Google 驗證與回呼正常。正式擁有者仍須親自完成一次 Google 綁定；目前 `APPLICATIONS_OPEN=false`，尚未開放公開申請。過往密碼模式紀錄見 [Cloudflare 個人試用紀錄](cloudflare-personal-trial.md)。

## 本次交付與上線閘門

沿用既有 Cloudflare Worker、D1、R2 及正式帳本。先交付本機驗收版本，取得兩組 Web Client ID 並完成真實登入、原帳本核對後，才開放申請。本機測試使用隔離資料庫與明確標示的測試身分，不等於通過真實 Google 登入。

## Google 設定

1. 在 Google Cloud Console 建立開發與正式兩個 Web OAuth client。只使用基本 Google Identity Services 登入，不要求 Gmail／Drive 等 API 權限，不需要 Client Secret。
2. 開發 Authorized JavaScript origins 填入 `http://localhost`、`http://localhost:3000`；Authorized redirect URI 填入 `http://localhost:3000/api/auth/google`。
3. 正式 client 使用 origin `https://tradergym.app` 及 redirect URI `https://tradergym.app/api/auth/google`。設定產品名稱、支援聯絡方式、首頁與 `/privacy`，依 Google Console 顯示完成品牌／網域驗證。
4. `.env.example` 複製為忽略提交的 `.env.local`，填開發用 `GOOGLE_CLIENT_ID`。正式 client ID 設在 Cloudflare Worker variables；不要把 `LOCAL_ACCOUNT_SERVICE` 放入正式環境。
5. 用外部 Chrome、Safari／手機瀏覽器實測；不能以 WebView 測試代替真實 Google 登入。

參考：[Google 設定](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)、[JWT 驗證](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)。

## 儲存架構

每個 Google `sub` 綁定一個內部 user ID，每位使用者只有一份目前 JSON。雲端 D1 儲存帳號、session hash、邀請、管理紀錄及交易快照版本。完整帳本一律以不可變物件寫入私有 R2，成功後才以 CAS 更新 D1 的指標。讀取 R2 時驗證 SHA-256。失敗或衝突不會改寫上一版指標；未被採用的物件保留於私有桶，禁止設定會刪除仍被 D1 引用物件的全桶到期規則。

這項擴充來自實際既有快照：緊湊 JSON 已超過 3 MB，D1 單筆字串／資料列上限為 2 MB。不能刪減行情來遷就容量。[D1 上限](https://developers.cloudflare.com/d1/platform/limits/)、[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)

v2.5.1 起，本機開發使用隔離的 Miniflare D1／R2 模擬綁定，與正式帳本相同儲存流程。`LOCAL_CLOUD_DIRECTORY` 指定模擬資料目錄；`LOCAL_RECORD_DIRECTORY` 僅用於舊本機帳本的唯讀轉移檢查。正式資料不複製到開發模擬資料庫。

## Cloudflare 部署準備

1. 在自己的 Cloudflare 帳號建立 D1 `traders-gym` 與私有 R2 `traders-gym-snapshots`。不要啟用 R2 公開網域或 r2.dev。
2. 執行 `npm ci`、`npm test`、`npm run lint`、`npx tsc --noEmit`、`npm run build`。
3. 執行 `node scripts/prepare-cloudflare.mjs --account-id=<Cloudflare帳號ID> --database-id=<實際UUID> --personal-email=<既有擁有者信箱> --google-client-id=<正式WebClientID> --bucket=traders-gym-snapshots --applications-open=false`。此步只產生 `dist/server/wrangler.cloudflare.json`，不建立資源或部署；每次重新建置後重跑，保留兩種登入設定。
4. 使用產生的 config，以 `wrangler d1 migrations apply DB --remote --config dist/server/wrangler.cloudflare.json` 套用 append-only migrations，再部署該 config。不要使用原本包含 placeholder database ID 的預設 build config。
5. 在開放團隊使用前完成舊資料移入與真實 Google 驗收；若使用 Cloudflare Access 暫時限制入口，需允許 Google callback 正常完成，不能把 Access 當成 app 權限驗證的替代。

## 舊資料移入與回復

- 既有雲端 `primary` 資料列在擁有者首次載入時原樣綁定；內容與版本不改寫。其他無 owner 的舊資料不列出、不自動分配。
- 本機 `primary.json` 同樣只會綁給擁有者。資料遷移前可執行 `node scripts/verify-account-migration.mjs <封存JSON路徑>`，以臨時資料夾核對完整內容與版本。
- 搬到全新的自有 Cloudflare 帳號時，先把既有完整 JSON 上傳私有 R2，保留原版本並建立 `primary` 的 D1 中繼資料與 SHA-256；在移入完成前不要先讓擁有者建立空白帳本。此跨帳號移入必須等實際 D1／R2 目標確定後執行，不能從本機自動覆蓋現有正式資料。
- 公開後若回復舊程式，先限制網站入口，再部署舊版本。保留新增表／欄位／R2 物件；舊 V2 沒有帳號隔離，不可公開提供舊 API。

## 待正式環境完成

- 設定真實 Google client、`tradergym.app` 網域與既有 R2／D1 bindings。
- 驗證擁有者、受邀者、未受邀者；桌面 Chrome／Safari、手機外部瀏覽器。
- 驗證 30 天 Cookie、到期、停用、強制登出及 Google redirect callback。
- 核對兩種登入讀取同一帳本 ID、SHA-256、版本與完整交易／行情資料；既有正式快照不需重新匯入。
- 通過後才合併、標記正式版本與發布 Release。

## 2026-10-05：雙登入與申請審核實作

本次以原帳號綁定 Google 的方式保留既有使用者 ID、帳本 ID 及版本，不依 email 自動合併。密碼 session 明確標記 provider 並驗證密碼指紋；無效密碼 session 不會退回 Google 驗證。擁有者在「系統管理 → 登入設定」重新確認密碼，再於五分鐘內選擇同一信箱的 Google 帳號完成連結。

申請頁 `/apply` 先以 Google 驗證，使用獨立的 30 分鐘受限 session。只有核准或既有受邀使用者才取得帳本 session。申請說明為 20–2,000 字；核准、邀請與歷程寫入同一交易，審核須帶入已讀取版本。撤銷邀請或停用帳號優先於歷史核准紀錄。申請審核不會寄信。

### 環境設定與入口

- 已確認本機 Client ID：`663565468691-kp8dcd5nto8dgb2sovhua80rnlqih9k8.apps.googleusercontent.com`。
- 已確認正式 Client ID：`663565468691-f8gbeogb460lh1a3n3p85sbjmeclc9to.apps.googleusercontent.com`。Client ID 是公開識別值，沒有取得或保存 Client Secret。
- Google Console：`https://console.cloud.google.com/auth/clients`，建立 Web application 類型用戶端。
- 本機 JavaScript origins：`http://localhost`、`http://localhost:3000`；redirect URI：`http://localhost:3000/api/auth/google`。
- 正式 JavaScript origin：`https://tradergym.app`；redirect URI：`https://tradergym.app/api/auth/google`。
- `.env.local` 使用 `GOOGLE_CLIENT_ID`；原有 `LOCAL_PERSONAL_EMAIL`、`LOCAL_PASSWORD_HASH_BASE64` 保留。`APPLICATIONS_OPEN=false` 為預設，只有明確設為 true 且擁有者已綁定才接受新申請。
- 雲端保留 `PERSONAL_PASSWORD_LOGIN`、`PERSONAL_LOGIN_EMAIL` 與既有密碼雜湊 secret，同時設定 `GOOGLE_CLIENT_ID`。不需要 Google Client Secret。
- API：`/api/auth/application`（本人查詢、提交、進入、登出）、`/api/auth/google-link`（擁有者連結）、`/api/admin/applications`（清單、詳情及審核），沿用既有 auth/admin 路由。

### 發布順序

1. 檢查正式站待同步資料已完成同步，取得當下 D1 與 R2 快照備份，記錄帳本 ID／版本／雜湊／成交及資金活動數量；不可用舊備份覆蓋較新資料。
2. 本機驗收與建置通過後，套用增量遷移 `0007_greedy_sentinel.sql`；包含申請歷程、受限 session、連結挑戰、邀請 Google 身分及舊 session provider 回填，不更動帳本 JSON。
3. 使用 `scripts/prepare-cloudflare.mjs` 產生部署設定；可同時提供 `--personal-email` 與 `--google-client-id`，正式網域預設為 `tradergym.app`，含 `www` Custom Domain 與 workers.dev 備援，先保持 `--applications-open=false`。
4. 驗證主網域 HTTPS、www 的 308 轉址、隱私頁及密碼備援，接著由擁有者在真實瀏覽器執行 Google 綁定，比對兩种登入讀取相同帳本。
5. Google Client ID、真實登入及原帳本核對完成後，才以 `--applications-open=true` 發布開放申請。之後部署需持續帶入目前 Google Client ID 與申請開放設定。
6. 回復部署只回復程式／關閉申請，不刪新資料表、不還原舊帳本蓋過新交易。新網域不搬移舊網域的 localStorage；從雲端取得已同步資料。

### 隔離驗證

- `tests/access-applications.test.mjs` 覆蓋原帳本保留、兩種登入、申請 session 隔離、CAS、並行審核、拒絕與重申請、交易回滾、撤銷／停用、CSRF、失效 session、nonce、限流及身分衝突。
- `tests/serve-access-preview.mjs` 僅接受 `/private/tmp/traders-gym-access-preview.*` 隔離目錄，提供合成身分供畫面驗收；不匯入正式程式與建置。
- 真實 Google 瀏覽器驗證與正式發布必須在 Client ID 設定完成後另外驗收，不以合成身分測試視為已完成。

### 2026-10-05 正式發布紀錄

- 發布前 391 項測試、Lint、TypeScript、建置與 Wrangler dry-run 通過；D1 只新增 `0007_greedy_sentinel.sql`，未更動帳本 JSON。
- 已備份當下 D1 匯出及兩份目前 R2 完整帳本，私人位置 `data/private/cloud-before-google-20261005/`。504 筆歷史版本的中繼資料在 D1 匯出中，既有 R2 歷史物件保留原處，未刪除或覆寫。
- `tradergym.app` 與 `www.tradergym.app` 綁定 `traders-gym`，綁定前預覽無衝突。HTTPS 回應 200；www 以 308 導向主網域並保留路徑及參數。
- 程式發布版本：`5f54e348-7bbc-415e-8b39-637320c2910b`；同步擁有者密碼備援的 Secret 後，目前版本：`ae6c1177-7ddc-4ea3-8c66-898feac78fe7`。只上傳密碼雜湊。
- 正式密碼登入、安全 Cookie、未登入 API 拒絕、管理後台及 Google 綁定入口通過；Chrome 真實 Google 驗證正確回到 `login?error=link_required`，沒有另建帳號。
- 測試帳本 v31 完整 SHA-256 與發布前相同。標準歷史帳本由 v473 在 06:48:56 UTC 自動儲存為 v474；差異僅 `marketBars` 與 `marketSnapshot`，569 筆成交、64 筆資金活動、計畫及策略資料一致。保留較新版本，不用舊備份覆蓋。差異與驗證報告均存於上述私人目錄。
- 正式帳號綁定與公開申請開放仍需依發布順序完成；本機綁定資料不直接複製至正式 D1。
