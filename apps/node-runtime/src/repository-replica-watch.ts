import { ChangeWakeup } from "./change-wakeup.js";
import { RepositoryReconciliationPool } from "./repository-reconciliation-pool.js";
import { watchRepositoryChanges } from "./repository-change-watch.js";
import type { RepositoryReplicaCycleTrigger } from "./repository-replica-coordinator.js";
import { ReplicaPeerBackoff } from "./repository-replica-peer-backoff.js";
import {
  ReplicaRecoverySchedule,
  type ReplicaReconcileOutcome,
} from "./repository-replica-recovery-backoff.js";
import type { SshRepositoryReplicaPeer } from "./repository-replica-ssh-peer.js";

type WatchedRepository = {
  replicaId: string;
  localRoot: string;
  peerRoot: string;
  conflictPolicy?: "hold" | "prefer_local" | "prefer_peer";
};

/** The peer gate as health reports it; `retryAt` is null while the peer is reachable. */
export interface ReplicaPeerBackoffState {
  retryAt: number | null;
  consecutiveFailures: number;
}

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
  /**
   * One cheap peer request that resolves true when the peer transport answered. It runs once per
   * back-off period while the peer is unreachable; omitted, the queued cycles themselves probe.
   */
  probePeer?(): Promise<boolean>;
  onPeerBackoff?(state: ReplicaPeerBackoffState): void;
  reconcile(
    repository: WatchedRepository,
    context: { trigger: RepositoryReplicaCycleTrigger },
  ): Promise<ReplicaReconcileOutcome | void>;
}): Promise<void> {
  const wakeup = new ChangeWakeup();
  const baseRecoveryIntervalMs = input.peerWatch === false ? input.fallbackIntervalMs : 60_000;
  const ceilingMs = input.idleRecoveryCeilingMs ?? baseRecoveryIntervalMs;
  const schedule = new ReplicaRecoverySchedule(
    input.repositories.map((repository) => repository.replicaId),
    baseRecoveryIntervalMs,
    ceilingMs,
  );
  // A one-shot run contacts the peer once per replica and stops, so only watching backs off.
  const peerGate = input.watch ? new ReplicaPeerBackoff(baseRecoveryIntervalMs, ceilingMs) : null;
  const reportInterval = () => {
    if (input.watch) input.onRecoveryInterval?.(schedule.recoveryIntervalMs);
  };
  const reportPeer = () => {
    if (peerGate !== null)
      input.onPeerBackoff?.({
        retryAt: peerGate.retryAt,
        consecutiveFailures: peerGate.consecutiveFailures,
      });
  };
  reportInterval();
  const hinted = new Set<string>();
  // Only replicas the gate parked run again when it reopens; every other replica keeps its own
  // schedule, and a parked replica with a queued run already has one.
  const reopen = () => {
    pool.notifyAll(peerGate!.takeParked().filter((replicaId) => !pool.busy(replicaId)));
  };
  const pool = new RepositoryReconciliationPool(input.repositories, {
    concurrency: input.maximumConcurrency ?? 4,
    coalesceMs: 250,
    reconcile: async (repository) => {
      const trigger = hinted.delete(repository.replicaId) ? "change" : "recovery";
      let outcome = (await input.reconcile(repository, { trigger })) ?? "not_current";
      if (peerGate !== null) {
        const observed = peerGate.observeCycle(repository.replicaId, outcome, Date.now());
        outcome = observed.outcome;
        if (observed.reopened) reopen();
        reportPeer();
      }
      schedule.observe(repository.replicaId, outcome, Date.now());
      reportInterval();
    },
    notify: () => wakeup.notify(),
  });
  let probe: Promise<void> | null = null;
  const startProbe = () => {
    probe = (input.probePeer ?? (async () => true))()
      .catch(() => false)
      .then((reachable) => {
        if (peerGate!.observeProbe(reachable, Date.now())) reopen();
        reportPeer();
        probe = null;
        wakeup.notify();
      });
  };
  const localStops: Array<() => void> = [];
  const remote = new Map<string, { stop: () => void; ready: boolean; retryAt: number }>();
  let localAvailable = true;
  let fallbackBy: number | null = null;
  let startup = true;
  const changed = (id: string) => {
    hinted.add(id);
    schedule.hint(id);
    reportInterval();
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
      const peerClosed = peerGate?.closed === true;
      const due = schedule.takeDue(Date.now()).filter((replicaId) => !pool.busy(replicaId));
      if (due.length > 0) pool.notifyAll(due);
      if (fallbackBy !== null && Date.now() >= fallbackBy) {
        if (pool.idle()) pool.notifyAll();
        fallbackBy = Date.now() + input.fallbackIntervalMs;
      }
      if (input.watch && input.peerWatch !== false && !peerClosed) {
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
      if (peerGate?.beginProbe(Date.now())) startProbe();
      if (!peerClosed) pool.startReady();
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
      // While the peer gate is closed, queued work and subscription retries wait for its probe.
      const deadlines = peerClosed
        ? [schedule.nextDueAt(), fallbackBy, probe === null ? peerGate!.retryAt : null]
        : [
            schedule.nextDueAt(),
            fallbackBy,
            pool.nextReadyAt(),
            ...[...remote.values()].filter((entry) => !entry.ready).map((entry) => entry.retryAt),
          ];
      const next = deadlines.filter((value): value is number => value !== null);
      await wakeup.wait(
        revision,
        next.length === 0 ? 60_000 : Math.max(0, Math.min(...next) - Date.now()),
        input.signal,
      );
    }
  } finally {
    for (const stop of localStops) stop();
    for (const entry of remote.values()) entry.stop();
    await pool.settle();
    await probe;
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
