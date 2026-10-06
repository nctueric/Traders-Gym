import { authError, normalizeEmail, OWNER_EMAIL, requireSameOrigin, sha256 } from './auth-core.mjs';

// These headers are trusted only behind Sites dispatch, with owner-only access.
// The first binding is created only by a browser page GET, never by API calls.
export async function requireSitesTrialUser(db, request, { mutation = false, bootstrap = false } = {}) {
  const subject=request.headers.get('oai-authenticated-user-id');
  const email=normalizeEmail(request.headers.get('oai-authenticated-user-email'));
  if(!subject || subject.length>256) throw authError('請先透過私人 Sites 登入');
  let binding=await db.prepare('SELECT subject,user_id FROM sites_trial_identity WHERE id=1').first();
  if(!binding && bootstrap && request.method==='GET' && email===OWNER_EMAIL) {
    const id=`trial_${await sha256(subject)}`, now=new Date().toISOString();
    await db.batch([
      db.prepare(`INSERT INTO app_users(id,google_sub,email,name,picture,status,created_at,last_login_at)
        SELECT ?,?,?,'Sites 個人試用','','ACTIVE',?,? WHERE NOT EXISTS(SELECT 1 FROM sites_trial_identity WHERE id=1)
        ON CONFLICT(id) DO NOTHING`).bind(id,`sites-trial:${subject}`,`${id}@sites-trial.invalid`,now,now),
      db.prepare('INSERT INTO sites_trial_identity(id,subject,user_id) VALUES(1,?,?) ON CONFLICT(id) DO NOTHING').bind(subject,id),
    ]);
    binding=await db.prepare('SELECT subject,user_id FROM sites_trial_identity WHERE id=1').first();
  }
  if(!binding || binding.subject!==subject) throw authError('此身分無法存取私人試用帳本',403);
  const active=await db.prepare("SELECT id FROM app_users WHERE id=? AND status='ACTIVE'").bind(binding.user_id).first();
  if(!active) throw authError('試用帳號已停用',403);
  if(mutation) requireSameOrigin(request);
  const expected=request.headers.get('x-workspace-session');
  let session=await db.prepare('SELECT id,expires_at FROM auth_sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 1').bind(binding.user_id,new Date().toISOString()).first();
  if(!session && bootstrap) {
    const id=crypto.randomUUID(),now=new Date().toISOString(),expires=new Date(Date.now()+30*86400000).toISOString();
    await db.prepare("INSERT INTO auth_sessions(id,token_hash,user_id,created_at,expires_at,provider) VALUES(?,?,?,?,?,'sites')").bind(id,await sha256(crypto.randomUUID()),binding.user_id,now,expires).run();
    session={id,expires_at:expires};
  }
  if(!session || ((mutation || expected) && expected!==session.id)) throw authError('登入工作階段已結束，請重新開啟工作台');
  return {id:binding.user_id,email,name:'Sites 個人試用',picture:'',isOwner:true,sessionId:session.id,expiresAt:session.expires_at,authProvider:'sites'};
}
