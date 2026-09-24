// Compress large JSON snapshots without dropping historical evidence.
export async function encodeSnapshotRequest(body) {
  if (body.length < 256_000 || typeof CompressionStream !== "function") return { body, headers: { "Content-Type": "application/json" } };
  const compressed = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return { body: compressed, headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" } };
}

export async function decodeSnapshotRequest(request) {
  const encoding = request.headers.get("content-encoding");
  if (!encoding || encoding === "identity") return request.json();
  if (encoding !== "gzip") throw Object.assign(new Error("不支援的儲存壓縮格式"), { status: 415 });
  if (!request.body) throw Object.assign(new Error("儲存資料為空"), { status: 400 });
  const reader = request.body.pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 51_000_000) {
        await reader.cancel();
        throw Object.assign(new Error("完整快照超過儲存上限，尚未寫入"), { status: 413 });
      }
      chunks.push(value);
    }
    return JSON.parse(await new Blob(chunks).text());
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error("儲存壓縮資料損壞，請重試"), { status: 400 });
  } finally { reader.releaseLock(); }
}
