import type { QualityRecordingScopeAdmission } from "./context-quality-scope.js";
import type { ProjectStorage } from "@lervo/project-storage";

type Draft = Parameters<ProjectStorage["events"]["append"]>[0];
interface PendingReport {
  bytes: Uint8Array;
  contentHash: string;
}
interface PendingCommit {
  scope?: QualityRecordingScopeAdmission;
  report?: PendingReport;
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
    const batch = queue.pending.filter((pending) => !pending.scope || pending.scope.isReady());
    queue.pending = queue.pending.filter((pending) => pending.scope && !pending.scope.isReady());
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
      const append = (
        transaction: Pick<
          Parameters<Parameters<ProjectStorage["events"]["transact"]>[0]>[0],
          "append"
        >,
        putReport?: (bytes: Uint8Array) => { contentHash: string },
      ) => {
        for (const [index, draft] of drafts.entries()) {
          const report = batch[index]!.report;
          if (report) {
            if (!putReport || putReport(report.bytes).contentHash !== report.contentHash)
              throw new Error("Quality report publication does not match its draft.");
          }
          const existing = storage.events.get(draft.eventId);
          transaction.append({ ...draft, occurredAt: existing?.occurredAt ?? draft.occurredAt });
        }
      };
      if (batch.some((pending) => pending.report)) {
        const writer = storage.events.reportWriter;
        if (!writer) throw new Error("The selected report writer is unavailable.");
        writer.transact((transaction) => append(transaction, transaction.putReport));
      } else {
        storage.events.transact((transaction) => append(transaction));
      }
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
    if (
      queue.scheduled ||
      !queue.pending.some((pending) => !pending.scope || pending.scope.isReady())
    )
      return;
    queue.scheduled = true;
    setImmediate(() => {
      void flush(storage, queue);
    });
  }
  return function commit(
    storage: ProjectStorage,
    assertCurrent: () => Promise<void>,
    prepare: () => Promise<Draft>,
    report?: PendingReport,
    scope?: QualityRecordingScopeAdmission,
  ): Promise<void> {
    let queue = queues.get(storage);
    if (!queue) {
      queue = { pending: [], admitted: 0, scheduled: false };
      queues.set(storage, queue);
    }
    if (queue.admitted >= 16)
      return Promise.reject(new Error("Quality commit admission exceeds its bound."));
    if (
      report &&
      (report.bytes.byteLength < 1 ||
        report.bytes.byteLength > 1_048_576 ||
        report.bytes.buffer instanceof SharedArrayBuffer)
    )
      return Promise.reject(new Error("Quality report exceeds its private byte bound."));
    const reportSnapshot = report
      ? { bytes: Uint8Array.from(report.bytes), contentHash: report.contentHash }
      : undefined;
    queue.admitted++;
    const prepared = Promise.resolve()
      .then(prepare)
      .then((draft) => structuredClone(draft));
    const result = new Promise<void>((resolve, reject) => {
      queue.pending.push({
        prepared,
        assertCurrent,
        resolve,
        reject,
        ...(reportSnapshot ? { report: reportSnapshot } : {}),
        ...(scope && reportSnapshot ? { scope } : {}),
      });
    });
    if (scope && reportSnapshot) {
      scope.admit();
      void scope.ready.then(() => schedule(storage, queue));
    }
    // The first settled preparation schedules a fixed batch on the next turn.
    void prepared.then(
      () => schedule(storage, queue),
      () => schedule(storage, queue),
    );
    return result;
  };
}
