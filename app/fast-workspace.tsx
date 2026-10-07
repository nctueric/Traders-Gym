/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { lazy, Suspense, useEffect, useState, useRef } from 'react';
import { loadHomeRecord } from '@/lib/home-record-client.mjs';
import { Brand } from './brand';
import { homeAmounts } from '@/lib/home-amounts.mjs';
import { formatCurrency, convertCurrency } from '@/lib/valuation.mjs';
const Workspace = lazy(() => import('./trade-workspace'));
export function HomePreview({ bootstrap, status }: {
    bootstrap: any;
    status: string;
}) {
    const h = bootstrap.home, c = bootstrap.preferences.valuationCurrency, a = homeAmounts(h, c, Date.parse(bootstrap.serverNow)), money = (v: number | null) => formatCurrency(v, c);
    return <div className="trading-workbench fast-home" data-home-version={bootstrap.account.version}><header className="workspace-navigation"><Brand /><span>持倉總覽</span></header><main className="content" id="workspace-main"><header className="topbar"><div><h1>持倉總覽</h1><p>{bootstrap.account.name}・v{bootstrap.account.version}</p></div><button className="primary" disabled>新增交易</button></header><p role="status">{status}</p><section className="panel overview-section" aria-label="資產"><header className="overview-section-head"><h2>資產</h2><label className="valuation-control">計價幣別 <select aria-label="計價幣別" disabled value={c}><option value="USD">美元 USD</option><option value="TWD">台幣 TWD</option></select></label><button className="text-button" disabled>新增資金</button></header><p>儲存時估值：{h.asOf.replace('T', ' ').slice(0, 19)} UTC{a.fxStale ? '・匯率待更新' : ''}</p><strong className="asset-value asset-primary" data-home-assets {...{ elementtiming: "tg-home-assets" }}>{money(a.total)}</strong>{a.total == null && <p>所需行情或匯率有缺口，完整金額顯示 —。</p>}<dl><dt>現金水位</dt><dd>{money(a.cash)}</dd><dt>持倉水位</dt><dd>{money(a.gross)}</dd><dt>交易損益</dt><dd>{money(a.profit)}</dd><dt>已實現損益</dt><dd>{money(a.realized)}</dd></dl></section><section className="panel" aria-label="持倉"><h2>持倉</h2><p>{h.positionCount} 個部位・{h.fillCount} 筆成交・交易資料完整度 {h.qualityPct}%</p>{h.positions.map((p: any) => <article key={p.id} className="position"><strong>{p.symbol}・{p.direction === 'LONG' ? '多' : '空'}</strong><span>{p.quantity} 股・成本 {formatCurrency(p.averageCost, p.currency)}</span><span>{money(convertCurrency(p.marketValue, p.currency, c, a.fx))}<small className="block">來源：{p.source || '未知'}・報價：{p.quoteAt || '未知'}</small></span></article>)}{h.positionCount > 20 && <p>其餘持倉隨完整帳本載入。</p>}</section></main></div>;
}
export default function FastWorkspace({ bootstrap: initial, requestedAccountId }: {
    bootstrap: any;
    requestedAccountId?: string;
}) {
    const revisionRetries = useRef(0);
    const [bootstrap, setBootstrap] = useState(initial), [record, setRecord] = useState<any>(null), [status, setStatus] = useState('首頁摘要已載入；完整帳本正在下載並驗證…'), [attempt, setAttempt] = useState(0);
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
