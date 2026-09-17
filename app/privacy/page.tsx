import { env } from "cloudflare:workers";
export const dynamic = "force-dynamic";
export default function PrivacyPage() {
  const personal = env.PERSONAL_PASSWORD_LOGIN === "true", sites = env.SITES_TRIAL_AUTH === "true";
  return <main className="auth-page"><article className="auth-panel"><h1>隱私與資料使用</h1>
    {personal ? <p>目前是 Cloudflare 個人測試版，僅開放指定帳號與密碼登入。伺服器保存加鹽密碼驗證值，不保存明文密碼。登入最長維持 12 小時；登出後該工作階段失效。Google 登入尚未啟用。</p>
      : sites ? <p>私人 Sites 試用以 ChatGPT 登入，使用平台驗證的身分建立獨立試用帳本，不以 email 合併 Google 帳本。</p>
        : <p>Google 模式使用受邀帳號的身分識別資料、姓名、email 與頭像。登入最長維持 30 天，隨時可以登出。</p>}
    <p>交易、資金、計畫與復盤資料儲存於獨立帳本。試用帳本不會自動合併原有 Google 或 Sites 帳本。</p>
    <p>系統不要求 Gmail 或 Google Drive 存取權限，不保存 Google 密碼。</p>
    <h2>雲端儲存與備份</h2>
    <p>{personal ? "本版部署於你的 Cloudflare 帳號" : "Sites 版由 OpenAI 管理的 Sites 平台託管"}，使用 D1 與私有 R2 保存帳本。本機開發模式使用本機檔案。雲端網站不會自動寫入你電腦的 Obsidian 資料夾，請下載完整 JSON 另存備份。</p>
    <p>目前帳本及首次保護版本不清理。歷史版本最近 7 天完整保留，其後每日保留一份至 30 天；可先預覽再分批清理。未執行清理時，較舊版本仍會保留。</p>
    <a href="/login">返回登入</a></article></main>;
}
