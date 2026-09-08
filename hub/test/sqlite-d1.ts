import { DatabaseSync } from "node:sqlite";

export function sqliteD1(sql: string) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(sql);
  const prepare = (query: string) => {
    let args: (string | number | null)[] = [];
    return {
      bind(...values: (string | number | null)[]) {
        args = values;
        return this;
      },
      async first() {
        return sqlite.prepare(query).get(...args) ?? null;
      },
      async all() {
        return { results: sqlite.prepare(query).all(...args), success: true };
      },
      async run() {
        const result = sqlite.prepare(query).run(...args);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  };
  const db = {
    prepare,
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}
