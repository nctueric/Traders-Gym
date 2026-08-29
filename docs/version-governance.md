# Traders-Gym 版本治理

## 分支角色

- `main`：已驗證的正式基線；功能變更透過 Pull Request 合併。
- `release/v1`：V1 必要維護；不接受 V2 體驗改版。
- `redesign/v2`：V2 改版主線；第一個產品變更提交才將版本升為 `2.0.0-alpha.1`。
- `v1.0.0`：大改版前的不可變還原點。

## 驗證規則

- Pull Request 合併到 `main` 前必須通過 GitHub Actions 的 `validate` 工作。
- `validate` 執行鎖定依賴安裝、227 項測試、ESLint 與正式建置。
- V2 驗收以前，不用 V2 分支覆蓋目前正式部署。

## Private 儲存庫限制

目前 GitHub 帳號方案不支援 Private 儲存庫的伺服器端 branch protection。為了維持交易系統原始碼與流程的私密性，本機啟用 `.githooks/pre-push`：

- 阻擋直接推送、force push 或刪除 `main`。
- 阻擋更新或刪除已發布的 `v1.0.0` tag。
- 功能工作推送到獨立分支，再由 GitHub Pull Request 合併。

此保護適用於已設定 `core.hooksPath=.githooks` 的 clone。若日後升級 GitHub Pro，應改用伺服器端 branch protection，要求 Pull Request、`validate` 成功、禁止 force push 與刪除，並保留本機 hook 作第二層防護。
