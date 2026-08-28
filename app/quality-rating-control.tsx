/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useId } from "react";
import { ENTRY_QUALITY_TAGS, exitQualityGroup, PROFIT_EXIT_QUALITY_TAGS, STOP_EXIT_QUALITY_TAGS } from "@/lib/quality-rating.mjs";

export function qualityTagLabel(value?: string | null) {
  return [...ENTRY_QUALITY_TAGS, ...PROFIT_EXIT_QUALITY_TAGS].find((tag) => tag.value === value)?.label || "待評";
}

export function QualityTagPicker({ cycle, kind, value, compact = false, onChange }: { cycle: any; kind: "entry" | "exit"; value?: string | null; compact?: boolean; onChange: (value: string) => void }) {
  // Detail and ledger may render the same cycle simultaneously.
  const instanceId = useId();
  const cycleId = cycle.id || cycle.cycleId;
  const group = kind === "entry" ? "ENTRY" : exitQualityGroup(cycle);
  const definitions = kind === "entry" ? ENTRY_QUALITY_TAGS : group === "PROFIT_EXIT" ? PROFIT_EXIT_QUALITY_TAGS : STOP_EXIT_QUALITY_TAGS;
  const title = kind === "entry" ? "買入點" : group === "PROFIT_EXIT" ? "獲利離場點" : "止損離場點";
  return <fieldset className={`quality-tag-picker ${compact ? "compact" : ""}`}><legend>{title}{!value && <small>待評</small>}{!compact && <small>單選一項・人工評分</small>}</legend><div>{definitions.map((tag) => { const id = `${instanceId}-${cycleId}-${kind}-${tag.value}`; return <label key={tag.value} className={`quality-tag-option ${String(tag.value).toLowerCase()} ${value === tag.value ? "selected" : ""}`} htmlFor={id} title={tag.description}><input id={id} type="radio" name={`${instanceId}-${cycleId}-${kind}-quality`} value={tag.value} checked={value === tag.value} onChange={() => onChange(tag.value)}/><span><b>{tag.label}</b>{!compact && <small>{tag.description}</small>}</span></label>; })}</div></fieldset>;
}
