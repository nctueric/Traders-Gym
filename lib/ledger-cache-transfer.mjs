// Immutable top-level references let draft checkpoints cross the worker boundary
// without cloning unchanged multi-megabyte price histories on the UI thread.
export function cacheDatasetPatch(previous, next) {
 if (!previous) return {replace:next};
 const set={},remove=[];
 for (const key of Object.keys(previous)) if (!(key in next)) remove.push(key);
 for (const [key,value] of Object.entries(next)) if (previous[key]!==value) set[key]=value;
 // buildTradeSnapshot creates a new envelope even when all evidence is unchanged.
 if (set.marketSnapshot && previous.marketSnapshot) {
  const before=previous.marketSnapshot,after=set.marketSnapshot;
  if (Object.keys(before).length===Object.keys(after).length && Object.keys(after).every(key=>before[key]===after[key])) delete set.marketSnapshot;
 }
 return {set,remove};
}
export function applyCacheDatasetPatch(previous, patch) {
 if (patch.replace) return patch.replace;
 if (!previous) throw Error('Missing cache checkpoint base');
 const next={...previous,...patch.set};
 for (const key of patch.remove) delete next[key];
 return next;
}
