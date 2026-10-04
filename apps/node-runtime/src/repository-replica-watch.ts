import { ChangeWakeup } from "./change-wakeup.js";
import { RepositoryReconciliationPool } from "./repository-reconciliation-pool.js";
import { watchRepositoryChanges } from "./repository-change-watch.js";
import type { RepositoryReplicaCycleTrigger } from "./repository-replica-coordinator.js";
import {
  ReplicaRecoveryBackoff,
  type ReplicaReconcileOutcome,
} from "./repository-replica-recovery-backoff.js";
import type { SshRepositoryReplicaPeer } from "./repository-replica-ssh-peer.js";

type WatchedRepository = {
  replicaId: string;
  localRoot: string;
  peerRoot: string;
  conflictPolicy?: "hold" | "prefer_local" | "prefer_peer";
};

export async function watchReplicaReconciliation(input: {
  repositories: WatchedRepository[];
  peer: SshRepositoryReplicaPeer;
  fallbackIntervalMs: number;
  /** Idle recovery back-off ceiling; omitted keeps a fixed recovery interval. */
  idleRecoveryCeilingMs?: number;
  maximumConcurrency?: number;
  watch: boolean;
  peerWatch?: boolean;
  signal?: AbortSignal;
  onRecoveryInterval?(recoveryIntervalMs: number): void;
  reconcile(
    repository: WatchedRepository,
    context: { trigger: RepositoryReplicaCycleTrigger },
  ): Promise<ReplicaReconcileOutcome | void>;
}): Promise<void> {
  const wakeup = new ChangeWakeup();
  const baseRecoveryIntervalMs = input.peerWatch === false ? input.fallbackIntervalMs : 60_000;
  const backoff = new ReplicaRecoveryBackoff(
    input.repositories.map((repository) => repository.replicaId),
    baseRecoveryIntervalMs,
    input.idleRecoveryCeilingMs ?? baseRecoveryIntervalMs,
  );
  // Only a watching coordinator runs recovery sweeps, so only it reports their interval.
  const reportInterval = (intervalMs: number) => {
    if (input.watch) input.onRecoveryInterval?.(intervalMs);
  };
  reportInterval(backoff.recoveryIntervalMs);
  const hinted = new Set<string>();
  let reconcileBy = Date.now() + baseRecoveryIntervalMs;
  const recoverAtBase = () => {
    reconcileBy = Math.min(reconcileBy, Date.now() + backoff.recoveryIntervalMs);
    reportInterval(backoff.recoveryIntervalMs);
  };
  const pool = new RepositoryReconciliationPool(input.repositories, {
    concurrency: input.maximumConcurrency ?? 4,
    coalesceMs: 250,
    reconcile: async (repository) => {
      const trigger = hinted.delete(repository.replicaId) ? "change" : "recovery";
      const outcome = (await input.reconcile(repository, { trigger })) ?? "not_current";
      if (backoff.observe(repository.replicaId, outcome)) recoverAtBase();
    },
    notify: () => wakeup.notify(),
  });
  const localStops: Array<() => void> = [];
  const remote = new Map<string, { stop: () => void; ready: boolean; retryAt: number }>();
  let localAvailable = true;
  let fallbackBy: number | null = null;
  let startup = true;
  const changed = (id: string) => {
    hinted.add(id);
    if (backoff.reset()) recoverAtBase();
    pool.notify(id);
  };
  try {
    if (input.watch) {
      for (const repository of input.repositories) {
        try {
          localStops.push(
            await watchRepositoryChanges(
              repository.localRoot,
              () => changed(repository.replicaId),
              () => {
                localAvailable = false;
                changed(repository.replicaId);
              },
            ),
          );
        } catch {
          localAvailable = false;
        }
      }
    }
    while (!input.signal?.aborted) {
      if (Date.now() >= reconcileBy) {
        let delay = backoff.recoveryIntervalMs;
        if (pool.idle()) {
          pool.notifyAll();
          delay = backoff.sweep();
          reportInterval(delay);
        }
        reconcileBy = Date.now() + delay;
      }
      if (fallbackBy !== null && Date.now() >= fallbackBy) {
        if (pool.idle()) pool.notifyAll();
        fallbackBy = Date.now() + input.fallbackIntervalMs;
      }
      if (input.watch && input.peerWatch !== false) {
        for (const repository of input.repositories) {
          const previous = remote.get(repository.replicaId);
          if (previous !== undefined && (previous.ready || previous.retryAt > Date.now())) continue;
          previous?.stop();
          const entry = { stop: () => {}, ready: false, retryAt: Date.now() + 60_000 };
          remote.set(repository.replicaId, entry);
          entry.stop = input.peer.subscribe(
            repository.peerRoot,
            () => {
              entry.ready = true;
              changed(repository.replicaId);
            },
            () => {
              entry.ready = false;
              entry.retryAt = Date.now() + 60_000;
              changed(repository.replicaId);
            },
          );
        }
      }
      if (startup) {
        pool.notifyAll();
        startup = false;
      }
      pool.startReady();
      if (!input.watch) {
        if (pool.idle() || input.signal?.aborted) break;
        const revision = wakeup.revision;
        await wakeup.wait(revision, 60_000, input.signal);
        continue;
      }
      if (pool.error() !== null) throw pool.error();
      const available = localAvailable && [...remote.values()].every((entry) => entry.ready);
      fallbackBy = available ? null : (fallbackBy ?? Date.now() + input.fallbackIntervalMs);
      const revision = wakeup.revision;
      const due = [
        reconcileBy,
        fallbackBy,
        pool.nextReadyAt(),
        ...[...remote.values()].filter((entry) => !entry.ready).map((entry) => entry.retryAt),
      ].filter((value): value is number => value !== null);
      await wakeup.wait(revision, Math.max(0, Math.min(...due) - Date.now()), input.signal);
    }
  } finally {
    for (const stop of localStops) stop();
    for (const entry of remote.values()) entry.stop();
    await pool.settle();
  }
  if (pool.error() !== null) throw pool.error();
}

export async function publishRepositoryChangeHints(input: {
  root: string;
  signal?: AbortSignal;
  write(line: string): void;
}): Promise<void> {
  const wakeup = new ChangeWakeup();
  let failed = false;
  const stop = await watchRepositoryChanges(
    input.root,
    () => wakeup.notify(),
    () => {
      failed = true;
      wakeup.notify();
    },
  );
  try {
    while (!input.signal?.aborted) {
      if (failed) throw new Error("The repository notification source is unavailable.");
      const revision = wakeup.revision;
      input.write('{"schemaVersion":1,"status":"changed"}\n');
      await wakeup.wait(revision, 60_000, input.signal);
      await new ChangeWakeup().wait(0, 250, input.signal);
    }
  } finally {
    stop();
  }
}
