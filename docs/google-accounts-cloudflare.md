# Google 帳號與 Cloudflare 上線手冊

## 本次交付與上線閘門

目前在 `feat/google-account-admin` 分支開發；既有 `main`／`v2.0.0` 維持正式版。使用者已確認未來部署到自有 Cloudflare，本次不部署 Sites、不公開入口、不發布正式 Release。Google Web Client ID 尚未建立，登入頁因此顯示「尚未開放」。本機測試使用隔離資料庫與明確標示的測試身分，並不等於通過真實 Google 登入。

## Google 設定

1. 在 Google Cloud Console 建立開發與正式兩個 Web OAuth client。只使用基本 Google Identity Services 登入，不要求 Gmail／Drive 等 API 權限，不需要 Client Secret。
2. 開發 Authorized JavaScript origins 填入實際開發網址，例如 `http://localhost:3002` 與 `http://127.0.0.1:3002`；Authorized redirect URI 加上各網址的 `/api/auth/google`。
3. 正式 client 使用最終 HTTPS 網域及 `https://<正式網域>/api/auth/google`。設定產品名稱、支援聯絡方式、首頁與 `/privacy`。依 Google Console 顯示完成品牌／網域驗證；不要假設 `chatgpt.site` 或未知網域已被核准。
4. `.env.example` 複製為忽略提交的 `.env.local`，填開發用 `GOOGLE_CLIENT_ID`。正式 client ID 設在 Cloudflare Worker variables；不要把 `LOCAL_ACCOUNT_SERVICE` 放入正式環境。
5. 用外部 Chrome、Safari／手機瀏覽器實測；不能以 WebView 測試代替真實 Google 登入。

參考：[Google 設定](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)、[JWT 驗證](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)。

## 儲存架構

每個 Google `sub` 綁定一個內部 user ID，每位使用者只有一份目前 JSON。雲端 D1 儲存帳號、session hash、邀請、管理紀錄及交易快照版本。小於 1.8 MB 的 JSON 沿用 D1；大型快照以不可變物件寫入私有 R2，成功後才以 CAS 更新 D1 的指標。讀取 R2 時驗證 SHA-256。失敗或衝突不會改寫上一版指標；未被採用的物件保留於私有桶，禁止設定會刪除仍被 D1 引用物件的全桶到期規則。

這項擴充來自實際既有快照：緊湊 JSON 已超過 3 MB，D1 單筆字串／資料列上限為 2 MB。不能刪減行情來遷就容量。[D1 上限](https://developers.cloudflare.com/d1/platform/limits/)、[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)

本機仍使用 `../自動儲存/目前帳號/<id>.json` 與歷史備份；登入資料庫為該資料夾內 `accounts.sqlite`，不與正式 D1 共用。可透過 `LOCAL_RECORD_DIRECTORY` 指向隔離資料夾。備份本機帳號狀態時，停止伺服器後備份整個資料夾，包括 SQLite；不可只複製執行中的單一 SQLite 主檔。

## Cloudflare 部署準備

1. 在自己的 Cloudflare 帳號建立 D1 `traders-gym` 與私有 R2 `traders-gym-snapshots`。不要啟用 R2 公開網域或 r2.dev。
2. 執行 `npm ci`、`npm test`、`npm run lint`、`npx tsc --noEmit`、`npm run build`。
3. 執行 `node scripts/prepare-cloudflare.mjs --database-id=<實際UUID> --google-client-id=<正式WebClientID> --bucket=traders-gym-snapshots`。此步只產生 `dist/server/wrangler.cloudflare.json`，不建立資源或部署；每次重新建置後重跑。
4. 使用產生的 config，以 `wrangler d1 migrations apply DB --remote --config dist/server/wrangler.cloudflare.json` 套用 append-only migrations，再部署該 config。不要使用原本包含 placeholder database ID 的預設 build config。
5. 在開放團隊使用前完成舊資料移入與真實 Google 驗收；若使用 Cloudflare Access 暫時限制入口，需允許 Google callback 正常完成，不能把 Access 當成 app 權限驗證的替代。

## 舊資料移入與回復

- 既有雲端 `primary` 資料列在擁有者首次載入時原樣綁定；內容與版本不改寫。其他無 owner 的舊資料不列出、不自動分配。
- 本機 `primary.json` 同樣只會綁給擁有者。資料遷移前可執行 `node scripts/verify-account-migration.mjs <封存JSON路徑>`，以臨時資料夾核對完整內容與版本。
- 搬到全新的自有 Cloudflare 帳號時，先把既有完整 JSON 上傳私有 R2，保留原版本並建立 `primary` 的 D1 中繼資料與 SHA-256；在移入完成前不要先讓擁有者建立空白帳本。此跨帳號移入必須等實際 D1／R2 目標確定後執行，不能從本機自動覆蓋現有正式資料。
- 公開後若回復舊程式，先限制網站入口，再部署舊版本。保留新增表／欄位／R2 物件；舊 V2 沒有帳號隔離，不可公開提供舊 API。

## 待正式環境完成

- 設定真實 Google client、最終網址及 R2／D1 bindings。
- 驗證擁有者、受邀者、未受邀者；桌面 Chrome／Safari、手機外部瀏覽器。
- 驗證 30 天 Cookie、到期、停用、強制登出及 Google redirect callback。
- 匯入現有快照並核對 SHA-256、版本與完整交易／行情資料。
- 通過後才合併、標記正式版本與發布 Release。
