import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  isRepositoryReplicaOpenDivergence,
  type RepositoryReplicaOpenDivergence,
} from "@lervo/sync";

import type { RepositoryReplicaConflictPolicy } from "./repository-replica-merge.js";

export const REPOSITORY_REPLICA_ID = /^[a-z][a-z0-9_-]{1,63}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const CONFLICT_POLICIES: readonly RepositoryReplicaConflictPolicy[] = [
  "hold",
  "prefer_local",
  "prefer_peer",
];

/** One open divergence identity and whether its canonical `diverged` event is recorded. */
export interface RepositoryReplicaDivergenceEntry extends RepositoryReplicaOpenDivergence {
  conflictPolicy: RepositoryReplicaConflictPolicy;
  divergedEventRecorded: boolean;
}

export interface RepositoryReplicaCoordinatorState {
  schemaVersion: 1;
  replicas: Record<string, { commonSnapshotHash: string; reconciledAt: string }>;
  /** At most one open divergence per replica; a new identity supersedes the previous one. */
  divergences?: Record<string, RepositoryReplicaDivergenceEntry>;
}

export class RepositoryReplicaCoordinatorStateError extends Error {
  readonly code = "repository_replica_state_invalid";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepositoryReplicaCoordinatorStateError";
  }
}

function divergenceEntry(replicaId: string, value: unknown): boolean {
  const entry = value as Partial<RepositoryReplicaDivergenceEntry>;
  return (
    isRepositoryReplicaOpenDivergence(value) &&
    entry.replicaId === replicaId &&
    CONFLICT_POLICIES.includes(entry.conflictPolicy!) &&
    typeof entry.divergedEventRecorded === "boolean"
  );
}

async function readState(path: string): Promise<RepositoryReplicaCoordinatorState> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { schemaVersion: 1, replicas: {} };
    throw new RepositoryReplicaCoordinatorStateError(
      "The repository replica coordinator state could not be read.",
      { cause: error },
    );
  }
  const state = value as Partial<RepositoryReplicaCoordinatorState> | null;
  if (
    typeof state !== "object" ||
    state === null ||
    state.schemaVersion !== 1 ||
    typeof state.replicas !== "object" ||
    state.replicas === null ||
    Object.entries(state.replicas).some(
      ([replicaId, item]) =>
        !REPOSITORY_REPLICA_ID.test(replicaId) ||
        !HASH.test(item.commonSnapshotHash) ||
        !Number.isFinite(Date.parse(item.reconciledAt)),
    ) ||
    (state.divergences !== undefined &&
      (typeof state.divergences !== "object" ||
        state.divergences === null ||
        Object.entries(state.divergences).some(
          ([replicaId, entry]) => !divergenceEntry(replicaId, entry),
        )))
  ) {
    throw new RepositoryReplicaCoordinatorStateError(
      "The repository replica coordinator state is invalid.",
    );
  }
  return state as RepositoryReplicaCoordinatorState;
}

async function writeState(path: string, state: RepositoryReplicaCoordinatorState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.next`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

/** Serializes read-modify-write updates of the coordinator state file within this process. */
export class RepositoryReplicaCoordinatorStateFile {
  private updateTail = Promise.resolve();

  constructor(readonly path: string) {}

  read(): Promise<RepositoryReplicaCoordinatorState> {
    return readState(this.path);
  }

  async update(change: (state: RepositoryReplicaCoordinatorState) => void): Promise<void> {
    const update = this.updateTail.then(async () => {
      const state = await readState(this.path);
      change(state);
      await writeState(this.path, state);
    });
    this.updateTail = update.catch(() => {});
    await update;
  }
}
