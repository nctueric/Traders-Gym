import { Brand } from '../../brand';
import { EmailRequest } from '../../login/email-request';
export default function ResetPage(){return <main className="auth-page"><section className="auth-panel"><Brand/><h1>忘記密碼</h1><p>輸入已設定 Mail 登入的信箱，我們會寄送重設連結。Google 會員可先使用 Google 登入，在帳號設定增加 Mail 登入。</p><EmailRequest purpose="reset"/><a href="/login?method=mail">返回登入</a></section></main>;}
