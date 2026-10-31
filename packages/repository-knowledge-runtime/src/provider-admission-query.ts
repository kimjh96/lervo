import type { DatabaseSync } from "node:sqlite";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";
import { providerPauseReprobeAt } from "./provider-pause-backoff.js";

export function admissionOwnerAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Query existing tables without changing admission ownership, schema or pause state. */
export function queryKnowledgeProviderAdmissionState(
  db: DatabaseSync,
  provider: "codex" | "claude",
  now: Date,
) {
  const pause = sqliteRow(
    db.prepare("SELECT * FROM provider_pauses WHERE provider = ?").get(provider),
  );
  const reason: "quota" | "authentication" | null =
    pause?.reason === "quota" || pause?.reason === "authentication" ? pause.reason : null;
  return {
    reason,
    nextReprobeAt:
      pause?.reset_at === null ? new Date(providerPauseReprobeAt(pause)).toISOString() : null,
    paused:
      pause !== undefined && (pause.reset_at === null || Number(pause.reset_at) > now.getTime()),
    observationHash: typeof pause?.observation_hash === "string" ? pause.observation_hash : null,
    resetAt: typeof pause?.reset_at === "number" ? new Date(pause.reset_at).toISOString() : null,
    activeCalls: sqliteRows(db.prepare("SELECT owner_pid, nonce FROM requests").all()).filter(
      (row) => row.nonce !== null && admissionOwnerAlive(Number(row.owner_pid)),
    ).length,
    observedAt:
      typeof pause?.observed_at === "number" ? new Date(pause.observed_at).toISOString() : null,
  };
}
