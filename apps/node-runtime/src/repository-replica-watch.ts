import { ChangeWakeup } from "./change-wakeup.js";
import { RepositoryReconciliationPool } from "./repository-reconciliation-pool.js";
import { watchRepositoryChanges } from "@lervo/repository-knowledge-runtime";
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

/** A lost watch source retries after the fallback interval, doubling to this ceiling. */
export const REPLICA_WATCH_RETRY_CEILING_MILLISECONDS = 15 * 60_000;

/**
 * ADR-0602: a change source that is down: the local repository watch or a peer subscription.
 * Health shows it for as long as it is down; it clears when every source is armed again.
 */
export interface ReplicaWatchBackoffState {
  source: "local" | "peer";
  consecutiveFailures: number;
  retryAt: number;
}

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
  /** ADR-0602: the worst source that is down, or null once all are armed. */
  onWatchBackoff?(state: ReplicaWatchBackoffState | null): void;
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
  // schedule. A parked replica whose run is still finishing in the pool gets one follow-up run.
  const reopen = () => {
    pool.notifyAll(peerGate!.takeParked());
  };
  let lastProbe: { at: number; reachable: boolean } | null = null;
  const probePeer = async () => {
    const reachable = await (input.probePeer ?? (async () => true))().catch(() => false);
    lastProbe = { at: Date.now(), reachable };
    return reachable;
  };
  // An isolated replica that fails on every local edit reuses a probe result younger than the
  // base interval, so its confirmations cost at most one peer request per interval.
  const confirmPeer = () =>
    lastProbe !== null && Date.now() - lastProbe.at < baseRecoveryIntervalMs
      ? Promise.resolve(lastProbe.reachable)
      : probePeer();
  const pool = new RepositoryReconciliationPool(input.repositories, {
    concurrency: input.maximumConcurrency ?? 4,
    coalesceMs: 250,
    reconcile: async (repository) => {
      const trigger = hinted.delete(repository.replicaId) ? "change" : "recovery";
      let outcome = (await input.reconcile(repository, { trigger })) ?? "not_current";
      if (peerGate !== null) {
        let observed = peerGate.observeCycle(repository.replicaId, outcome, Date.now());
        if (observed.confirm)
          observed = peerGate.confirmIsolated(
            repository.replicaId,
            await confirmPeer(),
            Date.now(),
          );
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
    probe = probePeer().then((reachable) => {
      if (peerGate!.observeProbe(reachable, Date.now())) reopen();
      reportPeer();
      probe = null;
      wakeup.notify();
    });
  };
  const retryDelay = (failures: number) =>
    Math.min(
      Math.max(REPLICA_WATCH_RETRY_CEILING_MILLISECONDS, input.fallbackIntervalMs),
      input.fallbackIntervalMs * 2 ** Math.min(Math.max(0, failures - 1), 30),
    );
  let localStops: Array<() => void> = [];
  const remote = new Map<
    string,
    { stop: () => void; ready: boolean; retryAt: number; failures: number }
  >();
  let localAvailable = true;
  let localFailures = 0;
  let localRetryAt = 0;
  let fallbackBy: number | null = null;
  let reportedWatch = "null";
  const reportWatch = () => {
    const local: ReplicaWatchBackoffState | null = localAvailable
      ? null
      : { source: "local", consecutiveFailures: localFailures, retryAt: localRetryAt };
    const peer = [...remote.values()]
      .filter((entry) => !entry.ready && entry.failures > 0)
      .sort((left, right) => right.failures - left.failures)[0];
    const state =
      local ??
      (peer === undefined
        ? null
        : { source: "peer" as const, consecutiveFailures: peer.failures, retryAt: peer.retryAt });
    const key = JSON.stringify(state);
    if (key === reportedWatch) return;
    reportedWatch = key;
    input.onWatchBackoff?.(state);
  };
  const localFailed = () => {
    if (localAvailable) localFailures += 1;
    localAvailable = false;
    localRetryAt = Date.now() + retryDelay(localFailures);
    reportWatch();
  };
  // ADR-0602: a lost local watch (for example ENOSPC) is re-armed with exponential backoff.
  const armLocal = async () => {
    for (const stop of localStops) stop();
    localStops = [];
    localAvailable = true;
    for (const repository of input.repositories) {
      try {
        localStops.push(
          await watchRepositoryChanges(
            repository.localRoot,
            () => changed(repository.replicaId),
            () => {
              localFailed();
              changed(repository.replicaId);
            },
          ),
        );
      } catch {
        localFailed();
      }
    }
    if (localAvailable) localFailures = 0;
    reportWatch();
  };
  let startup = true;
  const changed = (id: string) => {
    hinted.add(id);
    schedule.hint(id);
    reportInterval();
    pool.notify(id);
  };
  try {
    if (input.watch) await armLocal();
    while (!input.signal?.aborted) {
      if (input.watch && !localAvailable && Date.now() >= localRetryAt) {
        await armLocal();
        // The source was down, so a change may have been missed: look once.
        if (localAvailable) pool.notifyAll();
      }
      const peerClosed = peerGate?.closed === true;
      // ADR-0602: with the local watch and every peer subscription live, a change reaches this
      // loop as a hint, so no recovery cycle runs; recovery covers only a lost source.
      const watched =
        input.watch &&
        input.peerWatch !== false &&
        localAvailable &&
        input.repositories.every((repository) => remote.get(repository.replicaId)?.ready === true);
      const due = watched
        ? []
        : schedule.takeDue(Date.now()).filter((replicaId) => !pool.busy(replicaId));
      if (due.length > 0) pool.notifyAll(due);
      const downFailures = Math.max(
        localAvailable ? 0 : localFailures,
        ...[...remote.values()].filter((entry) => !entry.ready).map((entry) => entry.failures),
        1,
      );
      if (fallbackBy !== null && Date.now() >= fallbackBy) {
        if (pool.idle()) pool.notifyAll();
        fallbackBy = Date.now() + retryDelay(downFailures);
      }
      if (input.watch && input.peerWatch !== false && !peerClosed) {
        for (const repository of input.repositories) {
          const previous = remote.get(repository.replicaId);
          if (previous !== undefined && (previous.ready || previous.retryAt > Date.now())) continue;
          previous?.stop();
          // ADR-0602: an unopenable or lost subscription retries with exponential backoff.
          const failures = previous?.failures ?? 0;
          const entry = {
            stop: () => {},
            ready: false,
            retryAt: Date.now() + retryDelay(failures + 1),
            failures,
          };
          remote.set(repository.replicaId, entry);
          entry.stop = input.peer.subscribe(
            repository.peerRoot,
            () => {
              entry.ready = true;
              entry.failures = 0;
              reportWatch();
              changed(repository.replicaId);
            },
            () => {
              entry.ready = false;
              entry.failures += 1;
              entry.retryAt = Date.now() + retryDelay(entry.failures);
              reportWatch();
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
      fallbackBy = available ? null : (fallbackBy ?? Date.now() + retryDelay(downFailures));
      const revision = wakeup.revision;
      // While the peer gate is closed, queued work and subscription retries wait for its probe.
      const recoveryAt = watched ? null : schedule.nextDueAt();
      const deadlines = peerClosed
        ? [recoveryAt, fallbackBy, probe === null ? peerGate!.retryAt : null]
        : [
            recoveryAt,
            fallbackBy,
            pool.nextReadyAt(),
            ...[...remote.values()].filter((entry) => !entry.ready).map((entry) => entry.retryAt),
            input.watch && !localAvailable ? localRetryAt : null,
          ];
      const next = deadlines.filter((value): value is number => value !== null);
      // No deadline: wait for a hint alone, with no timer.
      await wakeup.wait(
        revision,
        next.length === 0 ? Number.POSITIVE_INFINITY : Math.max(0, Math.min(...next) - Date.now()),
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
    // The first line tells the subscriber the stream is live and the state may have moved.
    input.write('{"schemaVersion":1,"status":"changed"}\n');
    // ADR-0602: a quiet stream writes nothing and arms no timer. The SSH transport's own
    // keepalives (ServerAliveInterval) end a dead link, and the subscriber reacts to that EOF; a
    // stopped peer process that keeps the link open only matters once work is pending, and the
    // next transfer's command deadline reports it then.
    while (!input.signal?.aborted) {
      if (failed) throw new Error("The repository notification source is unavailable.");
      const revision = wakeup.revision;
      await wakeup.wait(revision, Number.POSITIVE_INFINITY, input.signal);
      if (input.signal?.aborted) break;
      input.write('{"schemaVersion":1,"status":"changed"}\n');
      // Coalesces a burst of edits into one line.
      await new ChangeWakeup().wait(0, 250, input.signal);
    }
  } finally {
    stop();
  }
}
