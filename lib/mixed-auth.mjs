import { verifyMemberSession } from './email-auth.mjs';
import { authError, requireSession } from './auth-core.mjs';

// Dispatch by stored provider, never by catching a failed password verification.
export function createMixedAuthenticator(db, password) {
  return async (request, options = {}) => {
    const user = await requireSession(db, request, { ...options, owner: false });
    if (user.authProvider === 'password') {
      if (!password) throw authError('密碼登入尚未開放', 403);
      const verified = await password.authenticate(request, options);
      const owner = await db.prepare('SELECT user_id FROM system_owner WHERE id=1').first();
      if (owner && owner.user_id !== verified.id) throw authError('此密碼帳號不是系統擁有者', 403);
      return verified;
    }
    if (user.authProvider === 'email') { await verifyMemberSession(db,user); if(options.owner&&!user.isOwner) throw authError('只有系統擁有者可以使用管理後台',403); return user; }
    if (user.authProvider !== 'google') throw authError('登入方式不適用', 403);
    if (options.owner && !user.isOwner) throw authError('只有系統擁有者可以使用管理後台', 403);
    return user;
  };
}
