import { ChangeWakeup } from "./change-wakeup.js";
import { watchRepositoryChanges } from "./repository-change-watch.js";
import type { SshRepositoryReplicaPeer } from "./repository-replica-ssh-peer.js";

export async function watchReplicaReconciliation(input: {
  repositories: Array<{ replicaId: string; localRoot: string; peerRoot: string }>;
  peer: SshRepositoryReplicaPeer;
  fallbackIntervalMs: number;
  watch: boolean;
  signal?: AbortSignal;
  reconcile(repository: { replicaId: string; localRoot: string; peerRoot: string }): Promise<void>;
}): Promise<void> {
  const wakeup = new ChangeWakeup();
  const dirty = new Set(input.repositories.map((repository) => repository.replicaId));
  const localStops: Array<() => void> = [];
  const remote = new Map<string, { stop: () => void; ready: boolean; retryAt: number }>();
  let localAvailable = true;
  let reconcileBy = Date.now() + 60_000;
  const changed = (id: string) => {
    dirty.add(id);
    wakeup.notify();
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
        for (const repository of input.repositories) dirty.add(repository.replicaId);
        reconcileBy = Date.now() + 60_000;
      }
      if (input.watch) {
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
      const selected = input.repositories.filter((repository) =>
        dirty.delete(repository.replicaId),
      );
      for (const repository of selected) {
        if (input.signal?.aborted) break;
        await input.reconcile(repository);
      }
      if (!input.watch || input.signal?.aborted) break;
      const revision = wakeup.revision;
      if (dirty.size === 0) {
        const available = localAvailable && [...remote.values()].every((entry) => entry.ready);
        await wakeup.wait(
          revision,
          Math.min(
            available ? 60_000 : input.fallbackIntervalMs,
            Math.max(0, reconcileBy - Date.now()),
          ),
          input.signal,
        );
        if (wakeup.revision === revision) {
          for (const repository of input.repositories) dirty.add(repository.replicaId);
          reconcileBy = Date.now() + 60_000;
        }
      }
      // One bounded batch absorbs editor save bursts; hints during reconciliation stay pending.
      await new ChangeWakeup().wait(0, 250, input.signal);
    }
  } finally {
    for (const stop of localStops) stop();
    for (const entry of remote.values()) entry.stop();
  }
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
