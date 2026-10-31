import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { openSqliteDatabase } from "@lervo/sqlite-connection";
import type { KnowledgeProviderAdmissionState } from "./provider-admission.js";
import { queryKnowledgeProviderAdmissionState } from "./provider-admission-query.js";
import { sqliteRows } from "./sqlite-row.js";

/** Optional host observations cannot create, migrate or repair the admission authority. */
export async function readKnowledgeProviderPauseStates(
  input: { directory?: string; now?: Date } = {},
): Promise<(KnowledgeProviderAdmissionState & { provider: "codex" | "claude" })[]> {
  try {
    const directory =
      input.directory ?? resolve(homedir(), ".lervo", "state", "knowledge-provider-admission");
    const parent = await lstat(directory);
    if (!parent.isDirectory() || parent.isSymbolicLink()) return [];
    const path = resolve(directory, "admission.sqlite");
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink()) return [];
    const db = openSqliteDatabase(path, { readOnly: true, busyTimeoutMs: 0 });
    try {
      const columns = sqliteRows(db.prepare("PRAGMA table_info(provider_pauses)").all());
      if (
        ![
          "provider",
          "reason",
          "observation_hash",
          "observed_at",
          "reset_at",
          "reprobe_attempts",
          "last_reprobe_at",
        ].every((name) => columns.some((column) => column.name === name))
      )
        return [];
      const now = input.now ?? new Date();
      return (["codex", "claude"] as const).map((provider) => ({
        provider,
        ...queryKnowledgeProviderAdmissionState(db, provider, now),
      }));
    } finally {
      db.close();
    }
  } catch {
    // An absent, old, locked or unreadable store must not suppress other continuity findings.
    return [];
  }
}
