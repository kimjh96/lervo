import { resolve } from "node:path";
import { ProjectStorageError, type ProjectStorage } from "@lervo/project-storage";
import type { QualityEventDraft } from "./context-quality-event.js";
import type { QualityRecordingScopeAdmission } from "./context-quality-scope.js";

interface PreparedReport {
  bytes: Uint8Array;
  contentHash: string;
  draft: QualityEventDraft;
  projectId?: string;
}
type Receipt = { eventId: string; artifactHash: string } | null;
interface PendingReport extends PreparedReport {
  scope: QualityRecordingScopeAdmission;
  admitted: boolean;
  resolve: (receipt: Receipt) => void;
  reject: (error: unknown) => void;
}
interface RootQueue {
  count: number;
  pending: PendingReport[];
  scheduled: boolean;
  active: boolean;
}
type Borrow = <T>(
  root: string,
  work: (storage: ProjectStorage, assertCurrent: () => Promise<void>) => Promise<T>,
) => Promise<T>;

/** Fixed, fully prepared groups borrow only after admission; the borrow is their final fresh guard. */
export function createQualityRecordingAdmission(borrow: Borrow) {
  const roots = new Map<string, RootQueue>();
  function reserve(root: string): RootQueue {
    let queue = roots.get(root);
    if ((!queue && roots.size >= 8) || (queue && queue.count >= 16))
      throw new Error("Quality report admission exceeds its bound.");
    if (!queue) {
      queue = { count: 0, pending: [], scheduled: false, active: false };
      roots.set(root, queue);
    }
    queue.count++;
    return queue;
  }
  function release(root: string, queue: RootQueue, count: number) {
    queue.count -= count;
    if (!queue.count) roots.delete(root);
    else if (queue.pending.length) schedule(root, queue);
  }
  function publish(storage: ProjectStorage, batch: PendingReport[]): Receipt[] {
    if ((storage.writableEventSchemaVersion ?? 0) < 6)
      throw new ProjectStorageError("storage_writer_not_active", "The report writer is inactive.");
    const writer = storage.events.reportWriter;
    if (!writer) throw new Error("The selected report writer is unavailable.");
    const accepted = batch.filter(
      (job) => job.projectId === undefined || job.projectId === storage.manifest.projectId,
    );
    if (accepted.length)
      writer.transact((transaction) => {
        for (const job of accepted) {
          if (transaction.putReport(job.bytes).contentHash !== job.contentHash)
            throw new Error("Quality report publication does not match its draft.");
          const existing = storage.events.get(job.draft.eventId);
          transaction.append({
            ...job.draft,
            projectId: storage.manifest.projectId,
            occurredAt: existing?.occurredAt ?? job.draft.occurredAt,
          });
        }
      });
    return batch.map((job) =>
      accepted.includes(job) ? { eventId: job.draft.eventId, artifactHash: job.contentHash } : null,
    );
  }
  function schedule(root: string, queue: RootQueue) {
    if (queue.scheduled || queue.active) return;
    queue.scheduled = true;
    setImmediate(() => {
      void flush(root, queue);
    });
  }
  async function flush(root: string, queue: RootQueue) {
    queue.scheduled = false;
    // Queue ownership precedes admission; already completing sources can register in this turn.
    for (const job of queue.pending)
      if (!job.admitted) {
        job.admitted = true;
        job.scope.admit();
      }
    const batch = queue.pending.filter((job) => job.scope.isReady());
    if (!batch.length) return;
    queue.pending = queue.pending.filter((job) => !job.scope.isReady());
    queue.active = true;
    try {
      // publish is synchronous: no asynchronous gap between this fresh borrow and publication.
      const receipts = await borrow(root, (storage) => Promise.resolve(publish(storage, batch)));
      batch.forEach((job, index) => job.resolve(receipts[index]!));
    } catch (error) {
      for (const job of batch) job.reject(error);
    } finally {
      queue.active = false;
      release(root, queue, batch.length);
    }
  }
  async function admit(
    root: string,
    report: PreparedReport,
    scope: QualityRecordingScopeAdmission,
  ): Promise<Receipt> {
    root = resolve(root);
    if (
      report.bytes.byteLength < 1 ||
      report.bytes.byteLength > 1_048_576 ||
      report.bytes.buffer instanceof SharedArrayBuffer
    )
      return Promise.reject(new Error("Quality report exceeds its private byte bound."));
    const snapshot = {
      ...report,
      bytes: Uint8Array.from(report.bytes),
      draft: structuredClone(report.draft),
    };
    const held = reserve(root);
    const result = new Promise<Receipt>((resolve, reject) =>
      held.pending.push({ ...snapshot, scope, admitted: false, resolve, reject }),
    );
    void scope.ready.then(() => schedule(root, held));
    schedule(root, held);
    return result;
  }
  return {
    admit,
    async runLegacy<T>(
      root: string,
      work: (storage: ProjectStorage, assertCurrent: () => Promise<void>) => Promise<T>,
    ): Promise<T> {
      root = resolve(root);
      const queue = reserve(root);
      try {
        return await borrow(root, work);
      } finally {
        release(root, queue, 1);
      }
    },
  };
}
