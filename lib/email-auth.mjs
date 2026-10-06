import { authError, json, normalizeEmail, requireSameOrigin, sessionCookie, sha256 } from './auth-core.mjs';
import { hashPassword, verifyPassword } from './password-auth.mjs';
import { bodyOf } from './access-applications.mjs';
const now = () => new Date().toISOString();
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2,'0')).join('');
const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const generic = '若此信箱符合條件，將收到驗證信。請查看收件匣與垃圾郵件；稍後可重新寄送。';
// Valid inert credential used only to equalize failed-login verification work.
const dummyHash = 'pbkdf2-sha256$100000$0000000000000000000000000000000000000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';
export function createResendMailer({ apiKey = '', from = 'TraderGym <no-reply@tradergym.app>', fetcher = fetch } = {}) {
  return async ({ email, url, purpose }) => {
    if (!apiKey) throw authError('寄信服務尚未設定，請使用 Google 或稍後再試',503);
    const subject = purpose === 'apply' ? 'TraderGym：驗證你的信箱' : purpose === 'reset' ? 'TraderGym：重設密碼' : 'TraderGym：設定 Mail 登入密碼';
    const response = await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':await sha256(url)},body:JSON.stringify({from,to:[email],subject,text:`${subject}\n\n請在 15 分鐘內開啟以下連結完成操作：\n${url}\n\n若不是你提出的要求，請忽略此信。此連結只能使用一次。`}),signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw authError('驗證信寄送未完成，請稍後重新寄送',503);
  };
}
export async function rateLimit(db, request, subject, cap=10) {
  const window = Math.floor(Date.now()/600000)*600000;
  for (const [key,max] of [[`email:${await sha256(subject)}`,cap],[`email-ip:${await sha256(request.headers.get('cf-connecting-ip')||'local')}`,100]]) {
    const result=await db.prepare(`INSERT INTO password_login_limits(key,window_start,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END,window_start=excluded.window_start RETURNING attempts`).bind(key,window).first();
    if(result.attempts>max) throw authError('操作次數過多，請 10 分鐘後再試',429);
  }
}
export async function verifyMemberSession(db,user) {
  const row=await db.prepare('SELECT c.password_hash,p.fingerprint FROM email_credentials c JOIN member_session_credentials p ON p.session_id=? WHERE c.user_id=?').bind(user.sessionId,user.id).first();
  if(!row || row.fingerprint!==await sha256(row.password_hash)) throw authError('登入已失效，請重新登入',401);
  return user;
}
export async function reauthenticateMember(db,request,user) {
  const body=await bodyOf(request); await rateLimit(db,request,`reauth:${user.id}`);
  const row=await db.prepare('SELECT password_hash FROM email_credentials WHERE user_id=?').bind(user.id).first();
  if(typeof body.password!=='string'||body.password.length>256||!await verifyPassword(body.password,row?.password_hash||dummyHash)||!row) throw authError('密碼不正確',400);
}
export function createEmailAuth({db,authenticate,access,password=null,ownerEmail='',sendMail=createResendMailer(),origin=''}) {
  async function issue(request,{purpose,email,name='',userId=null,sessionId=null}) {
    const value=random(), hash=await sha256(value), created=now();
    const canonical=origin||new URL(request.url).origin;
    const url=`${canonical}/email/verify#token=${value}&purpose=${purpose}`;
    await db.prepare('INSERT INTO email_tokens(token_hash,purpose,email,name,user_id,session_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(hash,purpose,email,name,userId,sessionId,new Date(Date.now()+900000).toISOString(),created).run();
    try { await sendMail({email,url,purpose}); }
    catch(error){await db.prepare('DELETE FROM email_tokens WHERE token_hash=?').bind(hash).run();throw error;}
    return json({ok:true,message:generic});
  }
  async function requestMail(request,body) {
    requireSameOrigin(request);
    const email=normalizeEmail(body.email), purpose=body.purpose;
    if(!validEmail(email)||!['apply','reset','setup'].includes(purpose)) throw authError('請確認信箱與操作類型',400);
    await rateLimit(db,request,`send:${email}`,3);
    if(purpose==='setup') {
      const user=await authenticate(request,{mutation:true});
      if(normalizeEmail(user.email)!==email) throw authError('請使用目前帳號的信箱',403);
      return issue(request,{purpose,email,userId:user.id,sessionId:user.sessionId});
    }
    if(purpose==='reset') {
      const user=await db.prepare("SELECT u.id FROM app_users u JOIN email_credentials c ON c.user_id=u.id WHERE u.email=? AND u.status='ACTIVE'").bind(email).first();
      if(!user)return json({ok:true,message:generic});
      return issue(request,{purpose,email,userId:user.id});
    }
    const name=String(body.name||'').trim();
    if(!name||name.length>100) throw authError('請填寫姓名（100 字以內）',400);
    return issue(request,{purpose,email,name});
  }
  async function activate(request,body,row) {
    if(typeof body.password!=='string'||[...body.password].length<12||body.password.length>256) throw authError('新密碼至少 12 字元，最多 256 字元',400);
    const hash=await hashPassword(body.password), time=now();
    const existing=row.user_id?await db.prepare("SELECT * FROM app_users WHERE id=? AND email=? AND status='ACTIVE'").bind(row.user_id,row.email).first():null;
    if(row.user_id&&!existing)throw authError('帳號已停用或身分已變更',403);
    if(row.session_id&&!await db.prepare("SELECT id FROM auth_sessions WHERE id=? AND user_id=? AND expires_at>?").bind(row.session_id,row.user_id,time).first())throw authError('原登入已失效，請重新登入後設定密碼',403);
    const id=row.user_id||crypto.randomUUID(), claim=crypto.randomUUID();
    const available = row.user_id ? `EXISTS(SELECT 1 FROM app_users WHERE id=? AND email=? AND status='ACTIVE')` : `EXISTS(SELECT 1 FROM account_invites WHERE email=? AND status='PENDING' AND identity_key=?) AND NOT EXISTS(SELECT 1 FROM app_users WHERE email=?)`;
    const args=row.user_id?[id,row.email]:[row.email,`email:${row.email}`,row.email];
    const sessionGuard=row.session_id?' AND EXISTS(SELECT 1 FROM auth_sessions WHERE id=? AND user_id=? AND expires_at>?)':'';if(row.session_id)args.push(row.session_id,id,time);
    const result=await db.batch([
      db.prepare(`UPDATE email_tokens SET consumed_at=?,claim_id=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>? AND ${available}${sessionGuard} RETURNING token_hash`).bind(time,claim,await sha256(body.token),time,...args),
      ...(!row.user_id?[db.prepare(`INSERT INTO app_users(id,google_sub,email,name,picture,status,created_at,last_login_at) SELECT ?,NULL,email,name,'','ACTIVE',?,? FROM email_tokens WHERE token_hash=? AND claim_id=?`).bind(id,time,time,await sha256(body.token),claim)]:[]),
      db.prepare(`INSERT INTO email_credentials(user_id,password_hash,verified_at,updated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM email_tokens WHERE token_hash=? AND claim_id=?) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,verified_at=excluded.verified_at,updated_at=excluded.updated_at`).bind(id,hash,time,time,await sha256(body.token),claim),
      db.prepare(`UPDATE account_invites SET status='ACCEPTED',accepted_at=? WHERE email=? AND status='PENDING' AND identity_key=? AND EXISTS(SELECT 1 FROM email_credentials WHERE user_id=? AND password_hash=?)`).bind(time,row.email,`email:${row.email}`,id,hash),
      db.prepare(`DELETE FROM auth_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM email_credentials WHERE user_id=? AND password_hash=?)`).bind(id,id,hash),
    ]);
    if(!result[0].results.length)throw authError('連結已使用、權限已變更或已到期，請重新取得驗證信',409);
    // Clear all older links after a successful credential change.
    await db.prepare('UPDATE email_tokens SET consumed_at=? WHERE email=? AND consumed_at IS NULL').bind(time,row.email).run();
    return json({ok:true,message:'密碼已設定，請使用 Mail 登入。'},200,{'Set-Cookie':sessionCookie('',request,0)});
  }
  async function handle(request) {
    if(request.method==='GET') {
      const user=await authenticate(request); const credential=await db.prepare('SELECT verified_at FROM email_credentials WHERE user_id=?').bind(user.id).first();
      return json({email:user.email,enabled:!!credential});
    }
    if(request.method!=='POST')throw authError('不支援的操作',405);
    requireSameOrigin(request);const body=await bodyOf(request);
    if(body.action==='request')return requestMail(request,body);
    if(body.action!=='consume'||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw authError('驗證連結無效',400);
    await rateLimit(db,request,'consume:'+body.token);
    const row=await db.prepare('SELECT * FROM email_tokens WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?').bind(await sha256(body.token),now()).first();
    if(!row)throw authError('連結已使用或到期，請重新取得驗證信',409);
    if(row.purpose!=='apply')return activate(request,body,row);
    const consumed=await db.prepare('UPDATE email_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL RETURNING token_hash').bind(now(),await sha256(body.token)).first();
    if(!consumed)throw authError('連結已使用，請重新取得驗證信',409);
    const response=await access.restricted(request,{sub:null,email:row.email,name:row.name});
    const headers=new Headers(response.headers);headers.delete('Location');return json({ok:true,redirect:'/apply'},200,headers);
  }
  async function login(request) {
    if(request.method!=='POST')throw authError('不支援的登入操作',405);
    requireSameOrigin(request); const body=await bodyOf(request), email=normalizeEmail(body.email);
    const row=await db.prepare('SELECT u.id,u.status,c.password_hash FROM app_users u JOIN email_credentials c ON c.user_id=u.id WHERE u.email=?').bind(email).first();
    if(email===normalizeEmail(ownerEmail)&&password&&!row)return password.login(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)}));
    await rateLimit(db,request,`login:${email}`);
    if(typeof body.password!=='string'||body.password.length>256||!await verifyPassword(body.password,row?.password_hash||dummyHash)||!row||row.status!=='ACTIVE')throw authError('帳號或密碼不正確',401);
    const value=random(), sessionId=crypto.randomUUID(), time=now();
    await db.batch([
      db.prepare(`INSERT INTO auth_sessions(id,token_hash,user_id,created_at,expires_at,provider) SELECT ?,?,u.id,?,?,'email' FROM app_users u JOIN email_credentials c ON c.user_id=u.id WHERE u.id=? AND u.status='ACTIVE' AND c.password_hash=?`).bind(sessionId,await sha256(value),time,new Date(Date.now()+43200000).toISOString(),row.id,row.password_hash),
      db.prepare('INSERT INTO member_session_credentials(session_id,fingerprint) SELECT id,? FROM auth_sessions WHERE id=?').bind(await sha256(row.password_hash),sessionId),
      db.prepare('UPDATE app_users SET last_login_at=? WHERE id=?').bind(time,row.id),
    ]);
    if(!await db.prepare('SELECT id FROM auth_sessions WHERE id=?').bind(sessionId).first())throw authError('登入狀態已變更，請重試',409);
    return json({ok:true},200,{'Set-Cookie':sessionCookie(value,request,43200)});
  }
  async function enter(request,user) {
    const accessState=await access.state(user);
    if(accessState==='ACTIVE')return json({ok:true,redirect:'/login?method=mail'});
    if(accessState!=='APPROVED')throw authError('目前尚無使用權限',403);
    await rateLimit(db,request,`send:${user.email}`,3);
    return issue(request,{purpose:'activate',email:user.email,name:user.name});
  }
  return {handle,login,enter};
}
