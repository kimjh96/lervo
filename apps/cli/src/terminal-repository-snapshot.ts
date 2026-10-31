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

/** Terminal hooks reuse private stat-identity hashes so a prompt or Stop never rehashes everything. */
export function captureTerminalRepositorySnapshot(
  root: string,
  deadlineMs?: number,
): Promise<RepositorySnapshot> {
  deadlineMs ??= hookSnapshotDeadline.getStore();
  return capturePersistentRepositorySnapshot(
    root,
    resolve(root, ".lervo/state/cache/terminal-repository-snapshot.json"),
    { ...defaultRepositorySnapshotPolicy, ...(deadlineMs === undefined ? {} : { deadlineMs }) },
  );
}
