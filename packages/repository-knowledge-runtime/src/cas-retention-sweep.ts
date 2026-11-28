// ADR-0658 and ADR-0660: the sweep of a settled pass. Each removal is fenced on the exact event
// head and leaves a tombstone; the slice's time box, not a fixed count, decides when it stops.
import type { ProjectStorage } from "@lervo/project-storage";

import { removeUnreachableCasObject, type CasReferenceFile } from "./cas-retention-files.js";
import type { CasRetentionObservation } from "./cas-retention-observation.js";
import { retentionNamedAt, type CasRetentionRoots } from "./cas-retention-policy.js";
import type { releasedConvergenceRecords } from "./cas-retention-record-shapes.js";
import { materializationTransactionState } from "./materialization-transaction.js";

/** Removed by every sweep that is not stopped by a yield or a moved head, however slow the host. */
export const SWEEP_MINIMUM_REMOVALS = 32;
/** A backstop on one sweep's unlinks, should the clock not advance. */
export const SWEEP_MAXIMUM_REMOVALS = 4_096;
/** A yield probe lists leases and admission state, so it runs at most this often. */
const YIELD_PROBE_INTERVAL_MS = 100;

export interface RetentionSweep {
  deleted: Set<string>;
  /** The sweep stopped before every eligible candidate was considered. */
  remaining: boolean;
  headMoved: boolean;
}

/** Whether the sweep has spent its slice or must yield to live work. */
function sweepLimit(
  observation: CasRetentionObservation,
  sliceEndsAt: number,
  shouldYield: () => Promise<boolean>,
): () => Promise<boolean> {
  let probedAt = Number.NEGATIVE_INFINITY;
  return async () => {
    const removed = observation.removedObjects;
    const now = Date.now();
    if (
      removed >= SWEEP_MAXIMUM_REMOVALS ||
      (removed >= SWEEP_MINIMUM_REMOVALS && now >= sliceEndsAt)
    )
      return true;
    if (now - probedAt < YIELD_PROBE_INTERVAL_MS) return false;
    probedAt = now;
    return shouldYield();
  };
}

export async function sweepUnreachableObjects(input: {
  storage: ProjectStorage;
  files: readonly CasReferenceFile[];
  eligible: ReadonlySet<string>;
  marked: ReadonlySet<string>;
  released: ReturnType<typeof releasedConvergenceRecords>;
  roots: CasRetentionRoots;
  before: number;
  observation: CasRetentionObservation;
  shouldYield: () => Promise<boolean>;
  sliceEndsAt: number;
}): Promise<RetentionSweep> {
  const { storage, roots, observation } = input;
  const deleted = new Set<string>();
  const headCurrent = () => (storage.events.latest()?.eventHash ?? null) === roots.head;
  const spent = sweepLimit(observation, input.sliceEndsAt, input.shouldYield);
  for (const file of input.files) {
    if (
      file.hash === null ||
      !input.eligible.has(file.hash) ||
      input.marked.has(file.hash) ||
      file.modifiedAt >= input.before ||
      retentionNamedAt(roots, input.released, file.hash) >= input.before
    )
      continue;
    if ((await spent()) || !headCurrent())
      return { deleted, remaining: true, headMoved: !headCurrent() };
    if ((await materializationTransactionState(storage.paths.repositoryRoot)) !== "clear")
      return { deleted, remaining: true, headMoved: false };
    // ADR-0658: the head is checked again after the tombstone, right before the unlink.
    if (!(await removeUnreachableCasObject(file, headCurrent, storage.paths.cas)))
      return { deleted, remaining: true, headMoved: true };
    deleted.add(file.hash);
    observation.removedObjects++;
    observation.reclaimedBytes += file.size;
  }
  return { deleted, remaining: false, headMoved: false };
}
