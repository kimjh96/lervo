import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { OutboxStore } from "@lervo/storage-contract";

import {
  MAXIMUM_REPOSITORY_KNOWLEDGE_OUTSTANDING,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
} from "./repository-change-source.js";

/**
 * Settled jobs that ADR-0457 intake degradation can now finish are re-queued once under this
 * destination. Enqueueing the original change event keeps the event chain the job source.
 */
export const REPOSITORY_KNOWLEDGE_INTAKE_REQUEUE_DESTINATION =
  "knowledge:repository:intake-requeue";

/** Failures that whole-job intake rejection caused and per-file degradation replaces. */
const INTAKE_REQUEUE_FAILURE_CODES: ReadonlySet<string> = new Set([
  "review_source_limit_exceeded",
  "repository_change_path_limit_exceeded",
  "asset_verification_required",
]);

/** A rebuildable scan position; losing it only repeats an idempotent scan. */
const CURSOR_PATH = ".lervo/state/knowledge/intake-requeue-cursor.json";
const PAGE_SIZE = 1_000;

interface ScanCursor {
  seq: number;
  eventHash: string;
}

async function readCursor(root: string, events: OutboxStore): Promise<number> {
  let cursor: Partial<ScanCursor>;
  try {
    cursor = JSON.parse(await readFile(resolve(root, CURSOR_PATH), "utf8")) as Partial<ScanCursor>;
  } catch {
    return 0;
  }
  if (!Number.isSafeInteger(cursor.seq) || (cursor.seq as number) < 1) return 0;
  const [event] = events.list({ afterSeq: (cursor.seq as number) - 1, limit: 1 });
  // A rebuilt or migrated store renumbers events; rescan rather than trust a foreign position.
  return event !== undefined && event.seq === cursor.seq && event.eventHash === cursor.eventHash
    ? event.seq
    : 0;
}

async function writeCursor(root: string, cursor: ScanCursor): Promise<void> {
  const path = resolve(root, CURSOR_PATH);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, ...cursor })}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}

/**
 * Re-queues, once, each change whose resolution failed only because the whole job was rejected
 * at intake. A successor resolution names the one it supersedes, so a change is never re-queued
 * twice. Queue capacity is shared with new jobs; a full queue defers the remainder to a later run.
 */
export async function requeueIntakeStalledRepositoryKnowledgeJobs(input: {
  repositoryRoot: string;
  events: OutboxStore;
  now?: () => Date;
}): Promise<{ requeued: number; deferred: number }> {
  const afterSeq = await readCursor(input.repositoryRoot, input.events);
  const stalled = new Set<string>();
  let last: ScanCursor | null = null;
  for (let position = afterSeq; ;) {
    const page = input.events.list({ afterSeq: position, limit: PAGE_SIZE });
    if (page.length === 0) break;
    for (const event of page) {
      position = event.seq;
      last = { seq: event.seq, eventHash: event.eventHash };
      if (event.type !== "repository.knowledge.resolved") continue;
      const payload = event.payload as Record<string, unknown>;
      const changeEventId = payload.changeEventId as string;
      if (payload.supersedesResolutionEventId !== undefined) stalled.delete(changeEventId);
      else if (
        payload.terminalState === "attention_required" &&
        INTAKE_REQUEUE_FAILURE_CODES.has(payload.failureCode as string)
      )
        stalled.add(changeEventId);
    }
  }
  const enqueuedAt = (input.now ?? (() => new Date()))().toISOString();
  let requeued = 0;
  let deferred = 0;
  for (const changeEventId of stalled) {
    const admitted = input.events.transact((transaction) => {
      if (
        transaction.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION) +
          transaction.outstandingCount(REPOSITORY_KNOWLEDGE_INTAKE_REQUEUE_DESTINATION) >=
        MAXIMUM_REPOSITORY_KNOWLEDGE_OUTSTANDING
      )
        return null;
      return transaction.enqueue({
        eventId: changeEventId,
        destinationId: REPOSITORY_KNOWLEDGE_INTAKE_REQUEUE_DESTINATION,
        enqueuedAt,
      }).inserted;
    });
    if (admitted === null) deferred++;
    else if (admitted) requeued++;
  }
  // Advance only past a fully admitted scan, so deferred changes are found again.
  if (deferred === 0 && last !== null) await writeCursor(input.repositoryRoot, last);
  return { requeued, deferred };
}
