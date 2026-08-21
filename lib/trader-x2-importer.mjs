function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]; const next = text[index + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && next === "\n") index += 1; row.push(cell); if (row.some((value) => value !== "")) rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function importTraderX2Csv(text, sourceName = "Trader X2.csv") {
  const rows = parseCsv(text.trim());
  const headers = rows.shift()?.map((header) => header.trim()) || [];
  const expected = ["Symbol", "Side", "Qty", "Fill Price", "Commission", "Closing Time"];
  const missing = expected.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`缺少必要欄位：${missing.join(", ")}`);
  const fills = []; const cashActivities = [];
  rows.forEach((values, index) => {
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column]?.trim() ?? ""]));
    if (record.Symbol === "$CASH" && record.Side.toUpperCase() === "DEPOSIT") {
      const amount = Number(record.Qty); const timestamp = `${record["Closing Time"].replace(" ", "T")}Z`;
      if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(record["Closing Time"])) throw new Error(`第 ${index + 2} 列現金活動格式不正確`);
      cashActivities.push({ id: `tx2-cash-${timestamp.replace(/\D/g, "")}-${index + 1}`, type: "DEPOSIT", amount, timestamp, accountId: null, currency: null, requiresReview: true, source: sourceName });
      return;
    }
    const [market, symbol] = record.Symbol.includes(":") ? record.Symbol.split(":", 2) : ["UNKNOWN", record.Symbol];
    const side = record.Side.toUpperCase() === "BUY" ? "BUY" : record.Side.toUpperCase() === "SELL" ? "SELL" : null;
    const quantity = Number(record.Qty); const price = Number(record["Fill Price"]); const fee = Number(record.Commission || 0);
    if (!symbol || !side || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(fee) || fee < 0 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(record["Closing Time"])) throw new Error(`第 ${index + 2} 列資料格式不正確`);
    const currency = ["TWSE", "TPEX"].includes(market) ? "TWD" : "USD";
    const timestamp = `${record["Closing Time"].replace(" ", "T")}Z`;
    fills.push({ id: `tx2-${timestamp.replace(/\D/g, "")}-${market}-${symbol}-${side}-${index + 1}`, accountId: currency === "TWD" ? "trader-x2-twd" : "trader-x2-usd", symbol, market, currency, side, quantity, price, fee, timestamp, source: sourceName });
  });
  return {
    version: "0.1.0",
    profile: { name: "Trader X2 交易帳本", baseCurrency: "USD", costMethod: "FIFO", importedAt: new Date().toISOString(), sourceTimezone: "UTC" },
    accounts: [{ id: "trader-x2-usd", name: "Trader X2 美股", currency: "USD" }, { id: "trader-x2-twd", name: "Trader X2 台股", currency: "TWD" }],
    fills,
    cashActivities,
    marketBars: [],
    settings: { quoteProvider: "market-adapter" },
    source: { fileName: sourceName, rowCount: rows.length, fillCount: fills.length, cashActivityCount: cashActivities.length, timezoneAssumption: "UTC（依既有截圖日期交叉核對）" },
  };
}
