import type { OutboxStore } from "@lervo/storage-contract";
import { mkdir, chmod, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";
import { sha256, stableId } from "@lervo/repository-knowledge";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

/** One bounded private projection. Reservations survive failures and process restarts. */
export async function reserveConvergenceProviderCall(input: {
  repositoryRoot: string;
  obligationId: string;
  events: OutboxStore;
  batchId: string;
  maximumCalls: number;
}): Promise<number> {
  const directory = resolve(input.repositoryRoot, ".lervo/state/knowledge");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "convergence-budgets.sqlite");
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink())
      throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const db = openSqliteDatabase(path, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS });
  await chmod(path, 0o600);
  db.exec(
    "CREATE TABLE IF NOT EXISTS budgets (batch_hash TEXT PRIMARY KEY, calls INTEGER NOT NULL, obligation_id TEXT)",
  );
  if (
    !sqliteRows(db.prepare("PRAGMA table_info(budgets)").all()).some(
      (row) => row.name === "obligation_id",
    )
  )
    db.exec("ALTER TABLE budgets ADD COLUMN obligation_id TEXT");
  let transaction = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transaction = true;
    for (const row of sqliteRows(
      db
        .prepare(
          "SELECT DISTINCT obligation_id FROM budgets WHERE obligation_id IS NOT NULL LIMIT 8192",
        )
        .all(),
    )) {
      const id = String(row.obligation_id);
      const terminal = input.events.get(stableId("evt", [id, "terminal"], 32));
      // A per-change review budget is scoped by the resolution event its job will record.
      if (
        (terminal?.type === "repository.knowledge.convergence.recorded" &&
          terminal.payload.obligationId === id) ||
        input.events.get(id)?.type === "repository.knowledge.resolved"
      )
        db.prepare("DELETE FROM budgets WHERE obligation_id=?").run(id);
    }
    const id = sha256(input.batchId);
    const prior = sqliteRow(db.prepare("SELECT calls FROM budgets WHERE batch_hash=?").get(id));
    const count = prior === undefined ? 0 : Number(prior.calls);
    if (!Number.isSafeInteger(count) || count < 0)
      throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
    if (count >= input.maximumCalls)
      throw new KnowledgeConvergenceRuntimeError("normalization_budget_exceeded");
    if (
      prior === undefined &&
      Number(sqliteRow(db.prepare("SELECT count(*) AS count FROM budgets").get())!.count) >= 8192
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
    db.prepare(
      "INSERT INTO budgets(batch_hash,calls,obligation_id) VALUES(?,?,?) ON CONFLICT(batch_hash) DO UPDATE SET calls=excluded.calls",
    ).run(id, count + 1, input.obligationId);
    db.exec("COMMIT");
    transaction = false;
    return count + 1;
  } catch (error) {
    if (transaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
