// Complete records are returned only by the server's checksum-verifying endpoint.
export async function loadHomeRecord(fetcher, bootstrap, signal) {
    const id = bootstrap.account.id, headers = { 'x-workspace-session': bootstrap.user.sessionId };
    const options = { cache: 'no-store', headers, signal };
    const response = await fetcher(`/api/trade-records?accountId=${encodeURIComponent(id)}`, options), record = await response.json();
    if (!response.ok)
        throw Error(record.error || '完整帳本驗證失敗');
    if (record.account?.id !== id || !record.dataset)
        throw Error('完整帳本與目前帳本不一致');
    if (record.account.version === bootstrap.account.version)
        return { record };
    const refresh = await fetcher(`/api/workspace/bootstrap?accountId=${encodeURIComponent(id)}`, options), fresh = await refresh.json();
    if (!refresh.ok || !fresh.home || fresh.account?.id !== id || fresh.user?.sessionId !== bootstrap.user.sessionId)
        throw Error('帳本版本已更新，請重整取得一致資料');
    return { bootstrap: fresh };
}
