# React 深色交易工作台驗收

日期：2026-09-05。分支：`redesign/react-workspace`。此分支為 UI 候選版，不是正式部署核准。

## 1. 基準封存

- 原開發分支：`feat/google-account-admin`。
- 封存提交：`38203c3`（Google 帳號、管理後台與部署準備）。
- 正式 main 保持 `f4baf2c`；未移動既有 release tag。
- 原版 242 項測試全部通過。
- 原交易 JSON 仍位於原目錄外的版本封存區，沒有加入 Git。
- 封存檔 SHA-256：`aea83055841d18332de4f97aa85877ab6cf1f3244fa6078ad71a9610e1c7e859`。
- 新版使用獨立 worktree 與隔離合成交易帳本；不讀寫正式交易 JSON。

## 2. 工作台骨架

- 1200px 起使用雙欄；1440px 實測清單与詳情同時可用。
- 新增 DetailFrame；既有匯入／管理確認仍採原生 dialog。
- 收合保留子元件，不丟棄表單；放大／還原不修改帳本。
- 切換閉環以交易 ID 重新建立詳情，避免前一筆復盤步驟／表單混用。
- 未加入時間線的計畫內容：取消切換保留、確認放棄後才切換。
- 390px 清單／詳情切換驗證通過，清單不卸載。

## 3. 全頁

- 今日、持倉、復盤、策略、績效、資料、新增交易、登入與管理後台套用同一深色系統。
- Canvas 圖表只調整顏色，不改數值或畫圖座標計算。
- 17 張桌面／手機截圖均無整頁橫向溢出；瀏覽器無 pageerror。
- 管理三分頁讀取通過；一般帳號看不到管理入口，直接請求回 403，未登入 API 回 401。
- Google 正式 Client ID 尚未設定；登入畫面誠實顯示尚未開放，未宣稱已完成 Google 真實登入驗收。

## 4. 行為回歸

- 245 項測試通過：原 242 項加 3 項新介面契約測試。
- 7 組既有 UI 計算基準摘要維持一致。
- lib、server、db、drizzle、worker、API 與 account-server 相對封存提交無差異。
- 真實本機隔離 API：復盤文字自動儲存成功後可讀回；手動儲存收到成功 PUT；匯出不含 session／Google email；匯入預覽取消不替換資料。
- 擁有者與一般帳號隔離讀取通過；一般帳號帳本仍為空白。
- 原測試涵蓋離線緊急恢復、CAS 衝突及 session 隔離；未將其誤稱為正式 Google／多装置端到端驗收。

## 5. 候選版檢查

- lint、TypeScript、Vinext 正式 build 通過。
- Wrangler dry-run 使用明確的測試 D1 ID、測試 bucket 與測試 Google client 值；沒有部署或建立正式資源。生成設定位於被 Git 忽略的 dist，禁止用它正式部署。
- 設計檢測器未報告機械式問題。獨立審查：SHIP with documented limitations。六項修正中四項 resolved，手機密度與表格裁切兩項 partial / acceptable。此結論僅涵蓋修正清單，不代表所有畫面狀態均已驗收。
- 已知限制：手機上方框架約 404px；寬表格仍需橫向捲動；缺行情的績效空狀態已檢查，但合成資料未涵蓋填滿的績效圖；Google 真實帳號及正式環境未驗收。
- GitHub CI／PR 狀態以 PR 上的實際結果為準。
- 首次 GitHub CI 發現測試變數 module 命名規則問題，已改為 loadedModule 後重跑。
- Cloudflare 非正式分支 webhook 仍設定 pnpm run build；2026-09-05 的失敗日誌確認 npm 安裝成功，但建置命令與 packageManager 不符。此部署設定未在 UI 分支任務中修改，Workers Builds 檢查仍未通過。正式發布不得視為就緒。

## 正式發布仍需完成

使用者 UI 驗收、R2 開通與正式綁定、Google 正式登入設定、原交易資料歸屬遷移、Cloudflare 外部瀏覽器／真實帳號驗收。不得因 UI 建置成功直接發布，亦不得合併 main 覆蓋原版。
