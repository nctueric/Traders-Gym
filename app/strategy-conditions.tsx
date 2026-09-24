/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { InfoPopover } from './info-popover';
import { checkStatus, evaluateStrategyConditions, RESULT_LABELS, selectNoConditions, updateConditionSelection } from '@/lib/strategy-conditions.mjs';

export function StrategyConditions({ version, value = {}, phase = 'ENTRY', context = {}, mode = 'edit', onChange }: { version: any; value?: any; phase?: string; context?: any; mode?: 'edit' | 'readonly' | 'audit'; onChange?: (value: any) => void }) {
  const audit = mode === 'audit', readonly = mode === 'readonly';
  const groups = evaluateStrategyConditions(version, value, phase, context);
  const row = (rule: any, group: any) => {
    const status = checkStatus(value.checks?.[rule.id]);
    const chosen = ['CONFIRMED', 'FOLLOWED'].includes(status);
    return <div className="strategy-choice-row" key={rule.id}>
      {group.any ? (readonly ? <><span>{rule.name}</span><b>{chosen ? '已選取' : '未選取'}</b></> : <button type="button" className="strategy-condition-toggle" aria-pressed={chosen} onClick={() => onChange?.(updateConditionSelection(value, rule.id, !chosen, group.group, audit))}>{rule.name}<span aria-hidden="true">{chosen ? '已選取' : '選取'}</span></button>) : <><span>{rule.name}</span>{readonly ? <b>{({ CONFIRMED: '符合', FOLLOWED: '遵守', NOT_MET: '未符合', VIOLATED: '違反', NOT_APPLICABLE: '不適用' } as any)[status] || '未確認'}</b> : <div className="strategy-status-options" role="group" aria-label={`${rule.name}確認`}>{(audit ? [['UNREVIEWED','待複盤'],['FOLLOWED','遵守'],['VIOLATED','違反'], ...(version?.formatVersion === 2 ? [] : [['NOT_APPLICABLE','不適用']])] : [['UNREVIEWED','待確認'],['CONFIRMED','符合'],['NOT_MET','未符合']]).map(([key,label]) => <button key={key} type="button" aria-pressed={status === key} onClick={() => onChange?.({ ...value, checks: { ...value.checks, [rule.id]: key } })}>{label}</button>)}</div>}</>}
      {(rule.criterion || rule.note || rule.appliesWhen && rule.appliesWhen !== 'ALWAYS') && <InfoPopover label={rule.name}><p>{rule.criterion || rule.note}</p>{rule.criterion && rule.note && <p>{rule.note}</p>}{rule.appliesWhen !== 'ALWAYS' && <p>{rule.appliesWhen === 'WINNING_POSITION' ? '獲利部位適用' : '虧損部位適用'}</p>}</InfoPopover>}
    </div>;
  };
  return <div className="strategy-conditions">{groups.map((group: any) => <section key={group.group} className="strategy-condition-group"><div className="strategy-group-title"><h4>{group.label}</h4><InfoPopover label={group.label}><p>{group.status === 'SKIPPED' ? '此策略不限市場，不列入遵守率分母。' : group.any ? '可多選，任一條件符合即通過；未選的替代條件不算違規。' : '適用條件需全部符合。'}</p><p>{audit ? '這是事後核對，不會覆寫成交時紀錄。' : '此為實際成交後的人工確認。'}</p></InfoPopover><span className={group.status === 'FAIL' ? 'negative' : group.status === 'PASS' ? 'positive' : 'muted'}>{group.status === 'PENDING' && audit ? '待複盤' : RESULT_LABELS[group.status as keyof typeof RESULT_LABELS]}{group.any && group.selectedCount > 0 ? ` · ${group.selectedCount} 項` : ''}</span></div>
      {group.status !== 'SKIPPED' && <>{group.rules.slice(0,3).map((rule: any) => row(rule, group))}{group.rules.length > 3 && <details><summary>其餘 {group.rules.length - 3} 項條件{group.status === 'PENDING' ? ` · ${group.pendingCount} 項待${audit ? '複盤' : '確認'}` : ''}</summary>{group.rules.slice(3).map((rule: any) => row(rule, group))}</details>}{!group.rules.length && <small className="muted">沒有適用條件，請於複盤核對版本。</small>}{group.any && (readonly ? (value.noneGroups?.includes(group.group) && <small className="muted">以上皆未符合</small>) : <button type="button" className="strategy-condition-toggle strategy-none-choice" aria-pressed={value.noneGroups?.includes(group.group) || false} onClick={() => onChange?.(selectNoConditions(value, group.group, group.rules, !value.noneGroups?.includes(group.group)))}>以上皆未符合</button>)}</>}
    </section>)}</div>;
}
