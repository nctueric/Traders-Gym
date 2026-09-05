// D1-shaped adapter for local development and isolated tests.
export function sqliteAdapter(sqlite) {
  function prepare(sql) {
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { return { meta: sqlite.prepare(sql).run(...args) }; },
      execute() { return sqlite.prepare(sql).all(...args); },
    };
    return statement;
  }
  return { prepare, async batch(statements) {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const result = statements.map(statement => ({ results: statement.execute() })); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
}
