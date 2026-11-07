// Minimal Cloudflare D1 stand-in backed by node:sqlite, with the real migrations
// applied. Lets tests run worker routes against an actual SQLite schema.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

const migrationsDir = new URL("../../migrations/", import.meta.url);

export function createD1({ failOn } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrationsDir).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, migrationsDir), "utf8"));
  }

  const execute = (sql, args, mode) => {
    if (failOn && failOn.test(sql)) throw new Error("Injected D1 failure");
    const statement = db.prepare(sql);
    if (mode === "first") return statement.get(...args) ?? null;
    if (mode === "all") return { results: statement.all(...args), success: true, meta: {} };
    if (/\breturning\b/i.test(sql)) {
      const results = statement.all(...args);
      return { results, success: true, meta: { changes: results.length } };
    }
    const info = statement.run(...args);
    return { results: [], success: true, meta: { changes: Number(info.changes) } };
  };

  const makeStatement = (sql, args = []) => ({
    sql, args,
    bind: (...values) => makeStatement(sql, values),
    first: async column => {
      const row = execute(sql, args, "first");
      return column && row ? row[column] : row;
    },
    all: async () => execute(sql, args, "all"),
    run: async () => execute(sql, args, "run")
  });

  return {
    raw: db,
    prepare: sql => makeStatement(sql),
    // D1 runs a batch as one transaction: any failure rolls back all statements.
    batch: async statements => {
      db.exec("BEGIN");
      try {
        const results = statements.map(statement => execute(statement.sql, statement.args, "run"));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  };
}
