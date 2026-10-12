import { DatabaseSync } from "node:sqlite";

const strongPragma = /PRAGMA\s+fullfsync\s*=\s*ON/iu;
const commit = /^\s*COMMIT\s*;?\s*$/iu;

/**
 * Counts COMMIT statements on connections that enabled full synchronization.
 * The count binds the protocol's per-commit allowance to commits that actually occurred.
 */
export function observeDurableCommits() {
  const original = DatabaseSync.prototype.exec,
    strong = new WeakSet();
  let count = 0;
  DatabaseSync.prototype.exec = function (sql, ...args) {
    const result = original.call(this, sql, ...args);
    if (strongPragma.test(sql)) strong.add(this);
    else if (strong.has(this) && commit.test(sql)) count++;
    return result;
  };
  return {
    count: () => count,
    restore() {
      DatabaseSync.prototype.exec = original;
    },
  };
}
