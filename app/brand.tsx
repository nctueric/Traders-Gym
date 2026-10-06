export function Brand({compact=false}:{compact?:boolean}) {
 return <div className="tg-brand"><svg className="tg-mark" viewBox="0 0 48 48" width="40" height="40" role="img" aria-label="TraderGym 上升 K 線訓練軌跡"><path d="M30 7a18 18 0 1 0 11 28H30M11 16h17M20 16v20" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M30 21v12M37 13v15M44 4v17" stroke="currentColor" strokeWidth="2"/><path d="M27 24h6v6h-6zM34 17h6v7h-6zM41 8h6v6h-6z" fill="currentColor"/></svg>{!compact&&<strong>TraderGym</strong>}</div>;
}
