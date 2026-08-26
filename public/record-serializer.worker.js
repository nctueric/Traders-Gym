self.onmessage = (event) => {
  try {
    self.postMessage({ json: JSON.stringify(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "資料序列化失敗" });
  }
};
