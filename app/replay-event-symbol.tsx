const SYMBOLS: Record<string, [string, string]> = {
  ENTRY: ["▲", "positive"], ADD: ["＋", "positive"],
  REDUCE: ["−", "exit"], EXIT: ["▼", "exit"],
  MAE: ["◇", "negative"], MFE: ["◆", "positive"],
  PLAN_STOP: ["⊥", "negative"], PLAN_TARGET: ["◎", "positive"],
  PLAN_INVALIDATION: ["!", "neutral"], RAPID_REPURCHASE: ["↻", "exit"],
  STRATEGY_ASSIGNED: ["⚑", "strategy"], RULE_FOLLOWED: ["✓", "positive"],
  RULE_VIOLATED: ["×", "negative"], ENTRY_CONTEXT: ["▤", "neutral"],
};
export function ReplayEventSymbol({type}: {type:string}) {
  const [glyph,tone] = SYMBOLS[type] || ["◇", "neutral"];
  return <i className={`replay-event-symbol symbol-${tone}`} aria-hidden="true">{glyph}</i>;
}
