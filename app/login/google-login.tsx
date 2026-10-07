"use client";
import { useEffect, useState } from 'react';
import { GoogleButton } from './google-button';
import { PasswordLogin } from './password-login';
import { Brand } from '../brand';
export function GoogleLogin({ clientId }: { clientId: string; passwordEnabled?: boolean }) {
  const [message,setMessage]=useState(''),[mail,setMail]=useState(false);
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(!active)return;const params=new URLSearchParams(location.search);const errors:Record<string,string>={link_required:'請先使用 Mail 登入，在帳號設定連結 Google，完成後即可使用 Google 登入原帳本。',denied:'帳號目前無使用權限，請聯絡管理者。',setup:'Google 登入尚未設定完成。',failed:'Google 驗證未完成，請重試。',expired:'登入已到期，請重新登入。'};setMessage(errors[params.get('error')||'']||'');setMail(params.get('method')==='mail'||params.get('error')==='link_required');});return()=>{active=false;};},[]);
  return <main className="auth-page"><section className="auth-panel tg-login" aria-labelledby="login-heading"><Brand/><h1 id="login-heading">把每次交易，練成經驗。</h1><p className="auth-intro">使用 Google 帳戶，接續你的交易與複盤。</p>
    {message&&<p className="account-alert" role="alert">{message}</p>}
    <div className="login-methods"><div aria-label="Google 登入"><GoogleButton clientId={clientId}/></div><button type="button" className="mail-choice" aria-expanded={mail} aria-controls="mail-login" onClick={()=>setMail(v=>!v)}>{mail ? '收起 Mail 備用登入' : '改用 Mail 備用登入'}</button></div>
    {mail&&<div id="mail-login" className="mail-login"><PasswordLogin embedded/><a href="/email/reset">忘記密碼</a></div>}
    <a className="demo-entry" href="/demo">訪客登入<span>使用示範帳本，離開後重置</span></a>
    <footer className="auth-footer"><a href="/privacy">隱私與資料使用</a><details><summary>登入說明</summary><p>建議使用 Google 登入。Google 登入後，可在「帳號設定」選擇設定 Mail 備用密碼，使用同一信箱與帳本。管理者可查看帳號最近登入及帳本名稱、版本與儲存狀態。只驗證身分，不存取信件或雲端硬碟。</p></details></footer>
  </section></main>;
}
