export function serializeInBackground(value, WorkerConstructor = globalThis.Worker, timeoutMs = 5000) {
  if (typeof WorkerConstructor !== "function") return Promise.resolve(JSON.stringify(value));
  return new Promise((resolve, reject) => {
    let worker, timer, finished = false;
    const finish = (json) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker?.terminate();
      try { resolve(typeof json === "string" && json ? json : JSON.stringify(value)); }
      catch (error) { reject(error); }
    };
    try {
      worker = new WorkerConstructor("/record-serializer.worker.js");
      worker.onmessage = (event) => finish(event.data?.json);
      worker.onerror = () => finish();
      worker.onmessageerror = () => finish();
      timer = setTimeout(() => finish(), timeoutMs);
      worker.postMessage(value);
    } catch { finish(); }
  });
}
