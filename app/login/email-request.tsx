"use client";
import { useRef,useState } from 'react';
export function EmailRequest({purpose='apply',email:initialEmail='',sessionId}: {purpose?:'apply'|'reset'|'setup';email?:string;sessionId?:string}) {
 const [email,setEmail]=useState(initialEmail),[name,setName]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');const pending=useRef(false);
 return <form className="password-login-form" onSubmit={async e=>{e.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');try{const r=await fetch('/api/auth/email',{method:'POST',headers:{'Content-Type':'application/json',...(sessionId?{'x-workspace-session':sessionId}:{})},body:JSON.stringify({action:'request',purpose,email,name}),signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok)throw new Error(data.error);setMessage(data.message);}catch(cause){setError(cause instanceof Error?cause.message:'寄送失敗，請稍後重試');}finally{pending.current=false;setBusy(false);}}}>
 {purpose==='apply'&&<label>姓名<input value={name} onChange={e=>setName(e.target.value)} autoComplete="name" required maxLength={100}/></label>}
 <label>Email<input type="email" value={email} readOnly={!!initialEmail} onChange={e=>setEmail(e.target.value)} autoComplete="email" required maxLength={254}/></label>
 {error&&<p role="alert" className="account-alert">{error}</p>}{message&&<p role="status" className="account-feedback">{message}</p>}
 <button className="primary" disabled={busy}>{busy?'寄送中…':message?'重新寄送驗證信':purpose==='reset'?'寄送重設密碼信':purpose==='setup'?'寄送密碼設定信':'驗證信箱'}</button>
 </form>;
}
