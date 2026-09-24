// Sort displayed values without changing the ledger; missing metrics always follow data.
export function sortCycleRows(cycles, key = 'closeAt', direction = 'desc') {
  const missing = v => v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v));
  return [...cycles].sort((a,b) => {
    const x=a[key], y=b[key];
    if(missing(x)||missing(y))return missing(x)===missing(y)?0:missing(x)?1:-1;
    const order=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'zh-TW',{numeric:true});
    return order*(direction==='asc'?1:-1) || String(b.closeAt).localeCompare(String(a.closeAt)) || String(a.id).localeCompare(String(b.id));
  });
}
