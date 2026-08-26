export function serializeInBackground(value, WorkerConstructor = globalThis.Worker) {
  if (typeof WorkerConstructor !== "function") return Promise.resolve(JSON.stringify(value));
  return new Promise((resolve, reject) => {
    const worker = new WorkerConstructor("/record-serializer.worker.js");
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data?.error) reject(new Error(event.data.error));
      else resolve(event.data?.json || "");
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("背景儲存程序失敗"));
    };
    worker.postMessage(value);
  });
}
