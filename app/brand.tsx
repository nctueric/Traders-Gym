export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="tg-brand"><svg className="tg-mark" viewBox="0 0 48 48" width="40" height="40" role="img" aria-label="TraderGym 訓練軌跡"><path d="M36 10a18 18 0 1 0 6 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/><path d="M13 16h20M23 16v20M33 25h9v9h-9" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/><circle cx="40" cy="13" r="3" fill="currentColor"/></svg>{!compact&&<strong>TraderGym</strong>}</div>;
}
