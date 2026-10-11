import type { DatabaseSync } from "node:sqlite";
import type { ProcessOwnership } from "./process-ownership.js";

type OwnerKind = "session" | "freeze";

export interface ScopeOwners {
  isStale(kind: OwnerKind, token: unknown, pid: number, identity: unknown): boolean;
}

/** Observe at most two conflicting sessions and one freeze without a SQLite write lock. */
export function observeScopeOwners(
  database: DatabaseSync,
  scope: string,
  ownership: ProcessOwnership,
): ScopeOwners {
  const sessions = database
    .prepare(
      "SELECT token, owner_pid AS pid, owner_identity AS identity FROM node_work_session WHERE scope = ? LIMIT 2",
    )
    .all(scope) as Record<string, unknown>[];
  const freeze = database
    .prepare(
      "SELECT freeze_token AS token, freeze_pid AS pid, freeze_identity AS identity FROM node_work_scope WHERE scope = ? AND freeze_pid IS NOT NULL",
    )
    .get(scope) as Record<string, unknown> | undefined;
  const snapshots = new Map<string, ProcessOwnership>();
  const key = (kind: OwnerKind, token: unknown, pid: unknown, identity: unknown) =>
    JSON.stringify([kind, token, pid, identity]);
  for (const [kind, row] of [
    ...sessions.map((row) => ["session", row] as const),
    ...(freeze ? [["freeze", freeze] as const] : []),
  ]) {
    if (typeof row.pid !== "number" || !Number.isSafeInteger(row.pid) || row.pid < 1) continue;
    snapshots.set(key(kind, row.token, row.pid, row.identity), ownership.snapshot(row.pid));
  }
  return {
    isStale(kind, token, pid, identity) {
      // A concurrent replacement was not observed; it cannot inherit stale evidence.
      return snapshots.get(key(kind, token, pid, identity))?.isStale(pid, identity) ?? false;
    },
  };
}
