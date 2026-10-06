// Keep keystrokes and IME composition out of expensive ledger renders.
export function createTextEditBuffer(initial, commit, { delay = 600, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let saved = initial, value = initial, timer = null, composing = false;
  const clear = () => { if (timer !== null) cancel(timer); timer = null; };
  const flush = () => { clear(); if (value !== saved) { commit(value); saved = value; } };
  const queue = () => { clear(); if (!composing && value !== saved) timer = schedule(flush, delay); };
  return {
    edit(next) { value = next; queue(); },
    composition(active) { composing = active; if (active) clear(); else queue(); },
    receive(next) { if (value !== saved) return false; saved = value = next; return true; },
    flush,
    dispose: clear,
  };
}
