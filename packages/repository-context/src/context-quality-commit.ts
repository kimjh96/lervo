import type { ProjectStorage } from "@lervo/project-storage";

type Draft = Parameters<ProjectStorage["events"]["append"]>[0];
interface PendingCommit {
  prepared: Promise<Draft>;
  assertCurrent: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}
interface Queue {
  pending: PendingCommit[];
  admitted: number;
  scheduled: boolean;
}

/** Drains a fixed set of admitted preparations before checking and committing their metadata. */
export function createContextQualityCommitQueue() {
  const queues = new WeakMap<ProjectStorage, Queue>();
  async function flush(storage: ProjectStorage, queue: Queue) {
    const batch = queue.pending.splice(0);
    try {
      // Drain failed batches too: their storage borrowers must outlive every accepted preparation.
      const results = await Promise.allSettled(batch.map((pending) => pending.prepared));
      const drafts: Draft[] = [];
      const failures: unknown[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") drafts.push(result.value);
        else failures.push(result.reason);
      }
      if (failures.length) throw new AggregateError(failures, "Quality preparation failed.");
      // Every artifact in this fixed batch completed before this fresh shared-handle observation.
      await batch[0]!.assertCurrent();
      storage.events.transact((transaction) => {
        storage.events.verifyIntegrity();
        for (const draft of drafts) {
          const existing = storage.events.get(draft.eventId);
          transaction.append({ ...draft, occurredAt: existing?.occurredAt ?? draft.occurredAt });
        }
      });
      for (const pending of batch) pending.resolve();
    } catch (error) {
      for (const pending of batch) pending.reject(error);
    } finally {
      queue.admitted -= batch.length;
      queue.scheduled = false;
      if (queue.pending.length) schedule(storage, queue);
    }
  }
  function schedule(storage: ProjectStorage, queue: Queue) {
    if (queue.scheduled || queue.pending.length === 0) return;
    queue.scheduled = true;
    setImmediate(() => {
      void flush(storage, queue);
    });
  }
  return function commit(
    storage: ProjectStorage,
    assertCurrent: () => Promise<void>,
    prepare: () => Promise<Draft>,
  ): Promise<void> {
    let queue = queues.get(storage);
    if (!queue) {
      queue = { pending: [], admitted: 0, scheduled: false };
      queues.set(storage, queue);
    }
    if (queue.admitted >= 16)
      return Promise.reject(new Error("Quality commit admission exceeds its bound."));
    queue.admitted++;
    const prepared = Promise.resolve()
      .then(prepare)
      .then((draft) => structuredClone(draft));
    const result = new Promise<void>((resolve, reject) => {
      queue.pending.push({ prepared, assertCurrent, resolve, reject });
    });
    // The first settled preparation schedules a fixed batch on the next turn.
    void prepared.then(
      () => schedule(storage, queue),
      () => schedule(storage, queue),
    );
    return result;
  };
}
