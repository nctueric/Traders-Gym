/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { lazy, Suspense, useEffect, useState, useRef } from 'react';
import { loadHomeRecord } from '@/lib/home-record-client.mjs';
import { Brand } from './brand';
import { homeAmounts } from '@/lib/home-amounts.mjs';
import { formatCurrency, convertCurrency } from '@/lib/valuation.mjs';
import { readLedgerRecordCache,readStaleLedgerRecordCache, writeLedgerRecordCache } from '@/lib/ledger-record-cache.mjs';
import {applyNormalizedOperations} from '@/lib/ledger-mutations.mjs';
const Workspace = lazy(() => import('./trade-workspace'));
async function readDeviceCache(options: { userId: string; accountId: string; version: number }, timeoutMs = 1500) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            readLedgerRecordCache(options),
            new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
        ]);
    }
    finally { if (timer) clearTimeout(timer); }
}
export function HomePreview({ bootstrap, status }: {
    bootstrap: any;
    status: string;
}) {
    const h = bootstrap.home, c = bootstrap.preferences.valuationCurrency, a = homeAmounts(h, c, Date.parse(bootstrap.serverNow)), money = (v: number | null) => formatCurrency(v, c);
    const dashboard = h.dashboard?.currencies?.[c], percent = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%` : '—';
    return <div className="trading-workbench fast-home" data-home-version={bootstrap.account.version}><header className="workspace-navigation"><Brand /><span>持倉總覽</span></header><main className="content" id="workspace-main"><header className="topbar"><div><h1>持倉總覽</h1><p>{bootstrap.account.name}・v{bootstrap.account.version}</p></div><button className="primary" disabled>新增交易</button></header><p role="status">{status}</p><section className="panel overview-section" aria-label="資產"><header className="overview-section-head"><h2>資產</h2><label className="valuation-control">計價幣別 <select aria-label="計價幣別" disabled value={c}><option value="USD">美元 USD</option><option value="TWD">台幣 TWD</option></select></label><button className="text-button" disabled>新增資金</button></header><p>儲存時估值：{h.asOf.replace('T', ' ').slice(0, 19)} UTC{a.fxStale ? '・匯率待更新' : ''}</p><strong className="asset-value asset-primary" data-home-assets {...{ elementtiming: "tg-home-assets" }}>{money(a.total)}</strong>{a.total == null && <p>所需行情或匯率有缺口，完整金額顯示 —。</p>}<dl><dt>現金水位</dt><dd>{money(a.cash)}</dd><dt>持倉水位</dt><dd>{money(a.gross)}</dd><dt>曝險比率</dt><dd>{a.total != null && a.total > 0 && a.gross != null ? percent(a.gross / a.total) : '—'}</dd><dt>交易損益</dt><dd>{money(a.profit)}</dd><dt>已實現損益</dt><dd>{money(a.realized)}</dd></dl>{dashboard && <><div className="performance-kpis" aria-label="摘要期間報酬"><div><span>當月報酬率</span><strong>{percent(dashboard.month?.rate)}</strong></div><div><span>YTD 報酬率</span><strong>{percent(dashboard.ytd?.rate)}</strong></div><div><span>當週報酬率</span><strong>{percent(dashboard.week?.rate)}</strong></div></div><div className="performance-kpis" aria-label="摘要月報酬比較">{(dashboard.months || []).map((row: any) => <div key={row.month}><span>{row.month}{row.partial ? ' 至今' : ''}</span><strong>組合 {percent(row.portfolio)}・QQQ {percent(row.benchmark)}</strong></div>)}</div></>}<p>完整閉環 {h.cycleCount}・未平倉 {h.positionCount}・成交紀錄 {h.fillCount}・資金活動 {h.cashActivityCount ?? 0}・資料完整度 {h.qualityPct}%</p></section><section className="panel" aria-label="持倉"><h2>持倉</h2><p>{h.positionCount} 個部位・{h.fillCount} 筆成交・交易資料完整度 {h.qualityPct}%</p>{h.positions.map((p: any) => <article key={p.id} className="position"><strong>{p.symbol}・{p.direction === 'LONG' ? '多' : '空'}</strong><span>{p.quantity} 股・成本 {formatCurrency(p.averageCost, p.currency)}</span><span>{money(convertCurrency(p.marketValue, p.currency, c, a.fx))}<small className="block">來源：{p.source || '未知'}・報價：{p.quoteAt || '未知'}</small></span></article>)}{h.positionCount > 20 && <p>其餘持倉隨完整帳本載入。</p>}</section></main></div>;
}
export default function FastWorkspace({ bootstrap: initial, requestedAccountId }: {
    bootstrap: any;
    requestedAccountId?: string;
}) {
    const revisionRetries = useRef(0);
    const [bootstrap, setBootstrap] = useState(initial), [record, setRecord] = useState<any>(null), [status, setStatus] = useState(initial.summaryStatus==='updating'?'帳本已保存，摘要正在更新；目前顯示最近一次有效資料。':'首頁摘要已載入；完整帳本正在下載並驗證…'), [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const observers: PerformanceObserver[] = [];
        if (typeof PerformanceObserver !== 'undefined')
            for (const type of ['element', 'paint'])
                if (PerformanceObserver.supportedEntryTypes.includes(type)) {
                    const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) {
                        if (type === 'element' && (entry as any).identifier === 'tg-home-assets' && !document.documentElement.dataset.tgAssetsPaint)
                            document.documentElement.dataset.tgAssetsPaint = String((entry as any).renderTime || entry.startTime);
                        if (type === 'paint' && entry.name === 'first-contentful-paint')
                            document.documentElement.dataset.tgFirstPaint = String(entry.startTime);
                    } });
                    observer.observe({ type, buffered: true });
                    observers.push(observer);
                }
        const controller = new AbortController();
        let active = true;
        void import('./trade-workspace');
        const hydrate = async () => {
            try {
                const cached = await readDeviceCache({ userId: bootstrap.user.id, accountId: bootstrap.account.id, version: bootstrap.account.version });
                if (!active) return;
                if (cached) {
                    setStatus('已從裝置快取載入；正在背景確認雲端版本…');
                    setRecord(cached);
                    return;
                }
                if(bootstrap.account.storageMode==='normalized'){
                    const stale=await readStaleLedgerRecordCache({userId:bootstrap.user.id,accountId:bootstrap.account.id,beforeVersion:bootstrap.account.version});
                    if(stale){
                        const deltaResponse=await fetch(`/api/trade-records/${encodeURIComponent(bootstrap.account.id)}/changes?afterVersion=${stale.account.version}`,{cache:'no-store',signal:controller.signal,headers:{'x-workspace-session':bootstrap.user.sessionId}}),delta=await deltaResponse.json();
                        if(deltaResponse.ok&&delta.version===bootstrap.account.version){
                            let dataset=stale.dataset,expected=stale.account.version+1,continuous=true;for(const change of delta.changes){if(change.version!==expected++){continuous=false;break;}dataset=applyNormalizedOperations(dataset,change.operations);}
                            if(continuous&&expected===delta.version+1){
                            const accounts=(stale.accounts||[]).map((account:any)=>account.id===bootstrap.account.id?bootstrap.account:account),updated={account:bootstrap.account,accounts,dataset,cacheSource:'device-delta'};
                            void writeLedgerRecordCache({userId:bootstrap.user.id,record:updated});setStatus('已套用雲端增量更新。');setRecord(updated);return;}
                        }
                    }
                }
                const loaded = await loadHomeRecord(fetch, bootstrap, AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]));
                if (!active)
                    return;
                if (loaded.bootstrap) {
                    if (++revisionRetries.current > 3)
                        throw Error('帳本持續更新，請稍後重試');
                    setBootstrap(loaded.bootstrap);
                    return;
                }
                performance.mark('tg-snapshot-verified');
                void writeLedgerRecordCache({ userId: bootstrap.user.id, record: loaded.record });
                setRecord(loaded.record);
            }
            catch (e) {
                if (active && !controller.signal.aborted)
                    setStatus(e instanceof Error ? e.message : '完整帳本載入失敗');
            }
        };
        performance.mark('tg-home-visible');
        document.documentElement.dataset.tgHomeVisible = String(performance.now());
        document.documentElement.dataset.tgFirstPaint = String(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0);
        void hydrate();
        return () => { active = false; controller.abort(); observers.forEach(observer => observer.disconnect()); };
    }, [bootstrap, attempt]);
    const preview = <><HomePreview bootstrap={bootstrap} status={status}/>{!/正在/.test(status) && <button className="ghost" onClick={() => { revisionRetries.current = 0; setStatus('完整帳本正在下載並驗證…'); setAttempt(v => v + 1); }}>重試完整帳本</button>}</>;
    return record ? <Suspense fallback={preview}><Workspace user={bootstrap.user} requestedAccountId={requestedAccountId} initialRecord={record} initialPreferences={bootstrap} loadingFallback={preview}/></Suspense> : preview;
}
