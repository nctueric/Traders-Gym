"use client";
import {useCallback, useEffect, useRef, useState} from 'react';
import {InfoPopover} from './info-popover';
import {MobileDetails} from './mobile-ui';
import {DialogFrame} from './workspace-ui';

type Ledger = {id: string; name: string; version: number; deletedAt?: string | null};
type Pending = {action: 'rename' | 'trash'; row: Ledger; name: string};
export function LedgerManager({fetcher, beforeChange, onChanged, onClose, embedded=false, currentId}: {
  embedded?: boolean; currentId?: string; fetcher: typeof fetch; beforeChange: () => Promise<unknown>;
  onChanged: (id?: string) => void; onClose: () => void;
}) {
  const [rows, setRows] = useState<Ledger[]>([]), [name, setName] = useState('');
  const [multiple, setMultiple] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const working = useRef(false);
  const load = useCallback(async () => {
    const response = await fetcher('/api/ledgers', {cache: 'no-store'}), data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return {accounts:data.accounts as Ledger[],multiple:data.capabilities?.multipleLedgers !== false};
  }, [fetcher]);
  useEffect(() => {void load().then(info=>{setRows(info.accounts);setMultiple(info.multiple);}).catch(e => setError(e.message));}, [load]);

  async function mutate(action: string, row?: Ledger, newName?: string) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try {
      await beforeChange();
      const info = await load(); const latest=info.accounts;setRows(latest);setMultiple(info.multiple);
      const current = latest.find(v => v.id === row?.id);
      const response = await fetcher('/api/ledgers', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action, id: row?.id, name: newName ?? name, baseVersion: current?.version})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (multiple && action !== 'trash' && action !== 'select') {
        const selected = await fetcher('/api/ledgers', {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({action: 'select', id: data.account.id})});
        if (!selected.ok) {
          setRows((await load()).accounts); setPending(null);
          throw new Error('帳本操作已完成，但切換失敗；請關閉後重新選擇帳本。');
        }
      }
      onChanged(action === 'trash' ? undefined : data.account.id);
    } catch (cause) {setError(cause instanceof Error ? cause.message : '操作未完成');}
    finally {working.current = false; setBusy(false);}
  }

  const content = <section className={embedded ? "ledger-manager ledger-inline" : "modal ledger-manager"}>
      <header className="panel-head"><div className="section-title-help"><h2>帳本</h2><InfoPopover label="帳本管理"><p>{multiple?"每本帳本獨立保存交易、資金與策略。移入回收筒後停止同步，仍可還原。":"交易、資金與策略儲存於雲端帳本。"}</p></InfoPopover></div>{!embedded&&<button className="ghost" disabled={busy} onClick={onClose}>關閉</button>}</header>
      {multiple&&<form className="ledger-create" onSubmit={event => {event.preventDefault(); void mutate('create');}}>
        <label>新帳本名稱<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="例如：美股波段"/></label>
        <button className="primary" disabled={busy || !name.trim()}>新增帳本</button>
      </form>}
      {error && <p role="alert" className="account-alert">{error}</p>}
      {pending && <form className="ledger-confirm" aria-label={pending.action === 'trash' ? '確認移入回收筒' : '重新命名帳本'} onSubmit={event => {event.preventDefault(); void mutate(pending.action, pending.row, pending.name);}}>
        {pending.action === 'trash' ? <p>將「{pending.row.name}」移入回收筒？停止同步後仍可還原。</p> : <label>帳本名稱<input required maxLength={100} value={pending.name} onChange={e => setPending({...pending, name: e.target.value})}/></label>}
        <div><button type="button" className="ghost" disabled={busy} onClick={() => setPending(null)}>取消</button><button className="primary" disabled={busy || !pending.name.trim()}>{pending.action === 'trash' ? '確認移入回收筒' : '儲存名稱'}</button></div>
      </form>}
      <ul className="ledger-list">{rows.filter(row => !row.deletedAt).map(row => <li key={row.id}>
        <strong>{row.name}{row.id===currentId&&<small> · 使用中</small>}</strong><div>
          {multiple&&embedded&&<button className="ghost" disabled={busy||row.id===currentId} onClick={()=>void mutate("select",row)}>切換</button>}
          <MobileDetails label="管理帳本" className="ledger-actions-menu"><div><button className="ghost" disabled={busy} onClick={() => setPending({action: 'rename', row, name: row.name})}>重新命名</button>
          {multiple&&<button className="ghost" disabled={busy} onClick={() => setPending({action: 'trash', row, name: row.name})}>移入回收筒</button>}</div></MobileDetails>
        </div>
      </li>)}</ul>
      {multiple&&<details><summary>回收筒（{rows.filter(row => row.deletedAt).length}）</summary><ul className="ledger-list">{rows.filter(row => row.deletedAt).map(row => <li key={row.id}><span>{row.name}</span><button className="ghost" disabled={busy} onClick={() => void mutate('restore', row)}>還原</button></li>)}</ul></details>}
    </section>;
  return embedded ? content : <DialogFrame label="管理帳本" onClose={() => {if (!busy) onClose();}}>{content}</DialogFrame>;
}
