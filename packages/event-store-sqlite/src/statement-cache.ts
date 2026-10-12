import type { DatabaseSync, StatementSync } from "node:sqlite";

const statements = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

/**
 * Reuses one compiled statement per connection and fixed SQL text.
 * Callers pass source literals only and use `get`, `all` or `run`, which reset the statement
 * before returning. Iterators and schema probes that rely on preparation failure keep
 * preparing their own statements.
 */
export function preparedStatement(database: DatabaseSync, sql: string): StatementSync {
  let cache = statements.get(database);
  if (cache === undefined) {
    cache = new Map();
    statements.set(database, cache);
  }
  let statement = cache.get(sql);
  if (statement === undefined) {
    statement = database.prepare(sql);
    cache.set(sql, statement);
  }
  return statement;
}
