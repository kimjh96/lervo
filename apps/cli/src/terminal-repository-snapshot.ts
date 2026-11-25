import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import {
  capturePersistentRepositorySnapshot,
  defaultRepositorySnapshotPolicy,
  type RepositorySnapshot,
} from "@lervo/orchestrator";

const hookSnapshotDeadline = new AsyncLocalStorage<number>();

export function withTerminalSnapshotDeadline<T>(
  deadlineMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  return hookSnapshotDeadline.run(deadlineMs, operation);
}

/**
 * How long before the hook's own deadline the capture stops, so a capture that runs out of time
 * persists the hashes it computed before the hook gives up on it and the process ends. Writing
 * lervo's 2.35 MB cache took 3–7 ms on a loaded Mac (2026-11-25); the cache is read before the
 * capture starts, so only the write falls in this reserve, which leaves room for a slower host.
 */
export const TERMINAL_SNAPSHOT_PERSIST_MARGIN_MS = 500;

/** Terminal hooks reuse private stat-identity hashes so a prompt or Stop never rehashes everything. */
export function captureTerminalRepositorySnapshot(
  root: string,
  deadlineMs?: number,
): Promise<RepositorySnapshot> {
  deadlineMs ??= hookSnapshotDeadline.getStore();
  return capturePersistentRepositorySnapshot(root, terminalRepositorySnapshotCachePath(root), {
    ...defaultRepositorySnapshotPolicy,
    ...(deadlineMs === undefined
      ? {}
      : { deadlineMs: deadlineMs - TERMINAL_SNAPSHOT_PERSIST_MARGIN_MS }),
  });
}

/** Where a checkout keeps the stat-identity hashes its terminal hooks reuse. */
export function terminalRepositorySnapshotCachePath(root: string): string {
  return resolve(root, ".lervo/state/cache/terminal-repository-snapshot.json");
}
