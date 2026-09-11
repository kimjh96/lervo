import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { captureRepositoryReplicaSnapshot } from "./repository-replica-git.js";
import type { RepositoryReplicaReceipt } from "./repository-replica-coordinator.js";

export class RepositoryReplicaReadinessError extends Error {
  readonly code = "repository_replica_not_ready";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepositoryReplicaReadinessError";
  }
}

async function receipt(repositoryRoot: string): Promise<RepositoryReplicaReceipt | null> {
  try {
    const value = JSON.parse(
      await readFile(resolve(repositoryRoot, ".lervo/state/repository-replica.json"), "utf8"),
    ) as RepositoryReplicaReceipt;
    if (
      value.schemaVersion !== 1 ||
      value.repositoryRoot !== repositoryRoot ||
      !/^sha256:[a-f0-9]{64}$/u.test(value.commonSnapshotHash) ||
      value.localSnapshotHash !== value.commonSnapshotHash ||
      value.peerSnapshotHash !== value.commonSnapshotHash ||
      !Number.isFinite(Date.parse(value.reconciledAt)) ||
      !["current", "pushed", "pulled"].includes(value.status)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));
}

export async function awaitRepositoryReplicaReadiness(input: {
  repositoryRoot: string;
  maximumStalenessMs: number;
  waitTimeoutMs: number;
  pollIntervalMs: number;
  nowMilliseconds?: () => number;
}): Promise<string> {
  const now = input.nowMilliseconds ?? Date.now;
  const deadline = now() + input.waitTimeoutMs;
  let lastFailure: unknown;
  let polling = true;
  while (polling) {
    const currentReceipt = await receipt(input.repositoryRoot);
    if (
      currentReceipt !== null &&
      now() - Date.parse(currentReceipt.reconciledAt) <= input.maximumStalenessMs
    ) {
      try {
        const snapshot = await captureRepositoryReplicaSnapshot(input.repositoryRoot);
        if (snapshot.snapshotHash === currentReceipt.commonSnapshotHash) {
          return snapshot.snapshotHash;
        }
      } catch (error) {
        lastFailure = error;
      }
    }
    const remainingMilliseconds = deadline - now();
    if (remainingMilliseconds <= 0) polling = false;
    else await wait(Math.min(input.pollIntervalMs, remainingMilliseconds));
  }
  throw new RepositoryReplicaReadinessError(
    "The repository replica did not reach a fresh, exact common snapshot before the work deadline.",
    lastFailure === undefined ? undefined : { cause: lastFailure },
  );
}
