import { authError, COOKIE_NAME, cookieValue, sha256, json, normalizeEmail } from './auth-core.mjs';
import { DEFAULT_PREFERENCES } from './member-preferences.mjs';
import { HOME_SCHEMA_VERSION } from './home-views.mjs';
function validHome(home) {
    const amounts = value => value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([c, v]) => ['USD', 'TWD'].includes(c) && typeof v === 'number' && Number.isFinite(v));
    const numberOrNull = value => value === null || (typeof value === 'number' && Number.isFinite(value));
    const textOrNull = value => value === null || typeof value === 'string';
    return home?.schemaVersion === HOME_SCHEMA_VERSION
        && typeof home.asOf === 'string' && Number.isFinite(Date.parse(home.asOf))
        && Array.isArray(home.positions) && home.positions.length <= 20
        && Number.isInteger(home.positionCount) && home.positionCount >= home.positions.length
        && Number.isInteger(home.fillCount) && home.fillCount >= 0
        && Number.isInteger(home.cycleCount) && home.cycleCount >= 0
        && Number.isFinite(home.qualityPct) && home.qualityPct >= 0 && home.qualityPct <= 100
        && typeof home.missingQuotes === 'boolean' && typeof home.cashNeedsReview === 'boolean'
        && amounts(home.assetByCurrency) && amounts(home.cashByCurrency) && amounts(home.grossByCurrency)
        && home.realized && ['USD', 'TWD'].every(c => numberOrNull(home.realized[c]))
        && home.positions.every(p => typeof p?.id === 'string' && typeof p.symbol === 'string'
            && Number.isFinite(p.quantity) && p.quantity > 0 && Number.isFinite(p.averageCost)
            && ['USD', 'TWD'].includes(p.currency) && ['LONG', 'SHORT'].includes(p.direction)
            && numberOrNull(p.price) && numberOrNull(p.marketValue) && textOrNull(p.quoteAt) && textOrNull(p.source));
}
// A primary read checks credentials, ownership, preferences and the exact committed view together.
export async function loadWorkspaceBootstrap({ db, request, passwordEmail = '', passwordHash = '', enabled = true, singleLedger = false }) {
    const started = performance.now(), token = cookieValue(request, COOKIE_NAME);
    if (!/^[a-f0-9]{64}$/.test(token))
        throw authError('請先登入');
    const requested = new URL(request.url).searchParams.get('accountId') || null;
    const hash = await sha256(token), authAt = performance.now();
    const row = await db.prepare(`SELECT u.id,u.email,u.name,u.picture,u.status,s.id session_id,s.expires_at,s.provider,
 o.user_id owner_id,c.password_hash,emailproof.fingerprint email_fingerprint,passproof.fingerprint password_fingerprint,
 p.preferences_json,a.account_id,a.account_name,a.version,a.updated_at,a.object_key,
 h.source_version,h.schema_version,h.source_hash,h.summary_json
 FROM auth_sessions s JOIN app_users u ON u.id=s.user_id LEFT JOIN system_owner o ON o.id=1
 LEFT JOIN email_credentials c ON c.user_id=u.id LEFT JOIN member_session_credentials emailproof ON emailproof.session_id=s.id
 LEFT JOIN password_session_credentials passproof ON passproof.session_id=s.id LEFT JOIN member_preferences p ON p.user_id=u.id
 LEFT JOIN trade_account_snapshots a ON a.owner_user_id=u.id AND a.deleted_at IS NULL AND a.archived_at IS NULL AND a.account_id=COALESCE(?,
 CASE WHEN ${singleLedger?1:0}=1 AND o.user_id IS NOT u.id THEN (SELECT account_id FROM member_ledger_bindings WHERE user_id=u.id) END,
 (SELECT chosen.account_id FROM trade_account_snapshots chosen JOIN member_preferences pref ON pref.user_id=chosen.owner_user_id AND pref.active_account_id=chosen.account_id WHERE chosen.owner_user_id=u.id AND chosen.deleted_at IS NULL AND chosen.archived_at IS NULL),
 (SELECT account_id FROM trade_account_snapshots WHERE owner_user_id=u.id AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC,account_id LIMIT 1))
 AND (?=0 OR o.user_id=u.id OR a.account_id=COALESCE((SELECT account_id FROM member_ledger_bindings WHERE user_id=u.id),(SELECT chosen.account_id FROM trade_account_snapshots chosen JOIN member_preferences pref ON pref.user_id=chosen.owner_user_id AND pref.active_account_id=chosen.account_id WHERE chosen.owner_user_id=u.id AND chosen.deleted_at IS NULL AND chosen.archived_at IS NULL),(SELECT account_id FROM trade_account_snapshots WHERE owner_user_id=u.id AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC,account_id LIMIT 1)))
 LEFT JOIN ledger_home_views h ON h.account_id=a.account_id AND h.owner_user_id=u.id AND h.source_version=a.version AND h.object_key=COALESCE(a.object_key,'')
 WHERE s.token_hash=? AND s.expires_at>?`).bind(requested, singleLedger?1:0, hash, new Date().toISOString()).first();
    const dbAt = performance.now();
    if (!row)
        throw authError('登入已到期，請重新登入');
    if (row.status !== 'ACTIVE')
        throw authError('此帳號已停用', 403);
    const expected = request.headers.get('x-workspace-session');
    if (expected && expected !== row.session_id)
        throw authError('登入帳號已變更', 401);
    if (row.provider === 'email') {
        if (!row.password_hash || row.email_fingerprint !== await sha256(row.password_hash))
            throw authError('登入已失效', 401);
    }
    else if (row.provider === 'password') {
        if (!passwordHash || row.id !== `personal_${await sha256(normalizeEmail(passwordEmail))}` || row.password_hash || row.password_fingerprint !== await sha256(passwordHash) || (row.owner_id && row.owner_id !== row.id))
            throw authError('登入已失效', 401);
    }
    else if (row.provider !== 'google')
        throw authError('登入方式不適用', 403);
    if (requested && !row.account_id)
        throw authError('無法存取此交易帳本', 403);
    const verifiedAt = performance.now();
    const saved = JSON.parse(row.preferences_json || '{}');
    let home = null;
    if (enabled && row.schema_version === HOME_SCHEMA_VERSION && /^[a-f0-9]{64}$/.test(row.source_hash || '')) {
        try {
            const parsed = JSON.parse(row.summary_json);
            if (validHome(parsed))
                home = parsed;
        }
        catch { /* A corrupt view falls back to the verified full snapshot. */ }
    }
    const result = { serverNow: new Date().toISOString(), user: { id: row.id, email: row.email, name: row.name, picture: row.picture, isOwner: row.owner_id === row.id, sessionId: row.session_id, expiresAt: row.expires_at, authProvider: row.provider }, account: row.account_id ? { id: row.account_id, name: row.account_name, version: row.version, updatedAt: row.updated_at } : null, preferences: { ...DEFAULT_PREFERENCES, ...saved }, configured: Object.keys(saved), home, fallback: Boolean(row.account_id && !home) };
    if (new TextEncoder().encode(JSON.stringify(result)).length > 65536) {
        result.home = null;
        result.fallback = Boolean(result.account);
    }
    return { data: result, timing: { auth: authAt - started + (verifiedAt - dbAt), d1: dbAt - authAt, summary: performance.now() - verifiedAt, total: performance.now() - started } };
}
export async function bootstrapResponse(options) { if (options.request.method !== 'GET')
    return json({ error: '僅允許讀取' }, 405); const start = performance.now(); try {
    const { data, timing } = await loadWorkspaceBootstrap(options), serializeAt = performance.now(), response = json(data);
    const end = performance.now();
    response.headers.set('Server-Timing', `auth;dur=${timing.auth.toFixed(2)}, d1;dur=${timing.d1.toFixed(2)}, summary;dur=${timing.summary.toFixed(2)}, serialize;dur=${(end - serializeAt).toFixed(2)}, total;dur=${(end - start).toFixed(2)}`);
    return response;
}
catch (e) {
    return json({ error: e.status ? e.message : '首頁摘要暫時無法載入' }, e.status || 503);
} }
