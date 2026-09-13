import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { ChangeWakeup } from "./change-wakeup.js";
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
  const wakeup = new ChangeWakeup();
  let watcher: FSWatcher | undefined;
  const state = resolve(input.repositoryRoot, ".lervo/state");
  try {
    watcher = watch(state, { persistent: false }, (_event, filename) => {
      if (filename === null || filename.toString() === "repository-replica.json") wakeup.notify();
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = undefined;
      wakeup.notify();
    });
    const requestPath = resolve(state, "repository-replica-request.json");
    const temporary = `${requestPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, nonce: randomUUID() }), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, requestPath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  } catch {
    watcher?.close();
    watcher = undefined;
  }
  try {
    let polling = true;
    let checkedReceipt: string | undefined;
    while (polling) {
      const revision = wakeup.revision;
      const currentReceipt = await receipt(input.repositoryRoot);
      if (
        currentReceipt !== null &&
        now() - Date.parse(currentReceipt.reconciledAt) <= input.maximumStalenessMs &&
        JSON.stringify(currentReceipt) !== checkedReceipt
      ) {
        try {
          checkedReceipt = JSON.stringify(currentReceipt);
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
      else {
        // Filesystem notifications may be coalesced; the bounded wait rechecks the receipt.
        await wakeup.wait(revision, Math.min(input.pollIntervalMs, 1_000, remainingMilliseconds));
        if (wakeup.revision === revision) checkedReceipt = undefined;
      }
    }
  } finally {
    watcher?.close();
  }
  throw new RepositoryReplicaReadinessError(
    "The repository replica did not reach a fresh, exact common snapshot before the work deadline.",
    lastFailure === undefined ? undefined : { cause: lastFailure },
  );
}
