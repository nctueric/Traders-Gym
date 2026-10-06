import { env } from 'cloudflare:workers';
export const dynamic = 'force-dynamic';
export default function PrivacyPage() {
  const sites = env.SITES_TRIAL_AUTH === 'true' && env.PERSONAL_PASSWORD_LOGIN !== 'true';
  return <main className="auth-page"><article className="auth-panel application-panel"><h1>隱私與資料使用</h1>
    <h2>登入身分</h2><p>{sites ? 'Sites 試用使用 ChatGPT 驗證身分，與其他登入帳號分開。' : 'TraderGym 使用 Google 帳號識別資料或已驗證的 Email、姓名驗證身分；伺服器只保存加鹽密碼驗證值，不保存明文密碼。'}</p>
    <p>Google 登入最長維持 30 天，密碼登入最長 12 小時。申請查詢身分最長 30 分鐘，只能存取自己的申請。登出後該工作階段失效。</p>
    <p>系統不要求 Gmail 或 Google Drive 存取權限，不保存 Google 密碼；Google 登入憑證不寫入瀏覽器持久快取或系統日誌。</p>
    <h2>管理後台可見資訊</h2><p>系統擁有者可查看會員姓名、信箱、帳號狀態、最近登入時間及有效登入工作階段數，以及各帳本的名稱、版本、資料大小、回收筒狀態與最後儲存時間。有效工作階段不代表目前在線。此管理清單不提供其他會員的成交或持倉明細。</p>
    <h2>申請資料</h2><p>姓名、已驗證的信箱與申請說明用於審核使用資格，僅本人及系統擁有者可以查看。請勿填入密碼、資產金額或其他不必要的敏感資料。</p>
    <p>修改與審核歷程會保留供核對，第一版不自動清理。需要刪除申請資料，請聯絡 <a href="mailto:nctueric@gmail.com">nctueric@gmail.com</a>。申請結果由網站查詢，不另寄 Email。</p>
    <h2>驗證信與訪客體驗</h2><p>驗證、設定與重設密碼信透過 Resend 寄送，使用你的信箱與必要的驗證連結。伺服器保存限時、單次使用的 token 雜湊，不保存明文密碼。重設密碼會撤銷既有登入。</p><p>訪客體驗使用合成資料，只保留於當次頁面記憶體，不保存至本機備援或雲端；重新整理或離開後重置。</p><h2>帳本與備份</h2><p>{sites ? 'Sites 試用由 Sites 平台託管。' : '正式網站由 Cloudflare Workers 託管，使用 D1 與私有 R2 保存帳本。'}本機開發環境使用本機檔案，與正式資料分開。</p>
    <p>交易、資金、計畫與複盤資料歸屬各自帳號。綁定 Google 時保留原帳號與帳本，不以相同信箱自動合併不同帳號。</p>
    <p>修改先保存於目前裝置的本機備援，再依背景同步或「立即儲存」流程寫入雲端。不同網域的本機快取不互通；跨裝置可讀取已完成同步的資料。</p>
    <p>移至回收筒的帳本停止同步，可由本人還原，本輪不提供永久清除。目前帳本及首次保護版本不自動清理。歷史版本可由管理者預覽後分批清理；可隨時下載完整 JSON 另存備份。雲端網站不會自動寫入電腦的 Obsidian 資料夾。</p>
    <a href="/login">返回登入</a>
  </article></main>;
}
