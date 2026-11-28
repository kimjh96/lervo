// ADR-0584 and ADR-0658: the one bounded receipt a retention pass leaves. Attention reads it, so a
// pass that stops, stalls, or cannot run at all must still say so here.
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";

import {
  CasRetentionBoundError,
  CasRetentionReferenceError,
  type CasRetentionReferenceFailure,
  unreadable,
} from "./cas-retention-errors.js";
import { CAS_RETENTION_OBSERVATION } from "./cas-retention-files.js";
import { writeRetentionProjection } from "./cas-retention-state.js";

/**
 * Consecutive stalls after which attention reports `cas_retention_stalled` and retention stops
 * asking for an early cycle. The CLI's attention reader uses the same bound.
 */
export const CAS_RETENTION_STALL_PASSES = 5;

/** Why a pass that reached its sweep removed nothing although candidates were past grace. */
export type CasRetentionStallCause = "inventory_changed" | "event_head_changed";

export interface CasRetentionObservation {
  schemaVersion: 1;
  observedAt: string;
  status: "yielded" | "collected" | "unavailable";
  /**
   * Set with `unavailable` (ADR-0584): `bound_exceeded` names a finite collector bound, a reference
   * failure (ADR-0658) names the path that stopped the pass, `no_space` means the disk was full,
   * and `failed` any other stop. With `yielded`, only `unstable_reference`: a file kept changing
   * while it was read.
   */
  failure: "bound_exceeded" | "failed" | "no_space" | CasRetentionReferenceFailure | null;
  /**
   * ADR-0658: the repository-relative path a reference failure names. Never a hash, content or
   * exception text.
   */
  reference?: string;
  /**
   * ADR-0658: consecutive passes that reached their sweep with candidates and removed nothing,
   * and why the last one did. Carried across cycles until a pass removes or finishes.
   */
  stalledPasses?: number;
  stallCause?: CasRetentionStallCause;
  /**
   * ADR-0660: the pass stopped with work left: unclassified records, unread references, eligible
   * candidates, or a stall below `CAS_RETENTION_STALL_PASSES`. The resident keeps retention due
   * while it is true. A pass that never looked, because it yielded first, carries the last answer.
   */
  remaining?: boolean;
  removedObjects: number;
  reclaimedBytes: number;
}

function observationPath(storage: ProjectStorage): string {
  return resolve(storage.paths.knowledgeState, CAS_RETENTION_OBSERVATION);
}

/** A fresh observation that carries the previous one's stall count forward. */
export async function startObservation(storage: ProjectStorage): Promise<CasRetentionObservation> {
  const observation: CasRetentionObservation = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    status: "yielded",
    failure: null,
    removedObjects: 0,
    reclaimedBytes: 0,
  };
  try {
    const previous = JSON.parse(await readFile(observationPath(storage), "utf8")) as {
      stalledPasses?: unknown;
      stallCause?: unknown;
      remaining?: unknown;
    };
    if (previous.remaining === true) observation.remaining = true;
    if (
      Number.isSafeInteger(previous.stalledPasses) &&
      (previous.stallCause === "inventory_changed" || previous.stallCause === "event_head_changed")
    ) {
      observation.stalledPasses = previous.stalledPasses as number;
      observation.stallCause = previous.stallCause;
    }
  } catch {
    // No readable previous observation: no stall to carry.
  }
  return observation;
}

/**
 * ADR-0660: whether work is left after this pass. A stall counts only below its bound, after which
 * attention owns it; a failure that stopped the pass needs the owner, never an early cycle.
 */
export function noteRemaining(observation: CasRetentionObservation, remaining: boolean) {
  observation.remaining =
    remaining && (observation.stalledPasses ?? 0) < CAS_RETENTION_STALL_PASSES;
}

/** A sweep that removed nothing because the head moved is a stall; any other sweep is progress. */
export function noteSweep(observation: CasRetentionObservation, headMoved: boolean) {
  if (headMoved && observation.removedObjects === 0) noteStall(observation, "event_head_changed");
  else noteProgress(observation);
}

export function noteStall(observation: CasRetentionObservation, cause: CasRetentionStallCause) {
  observation.stalledPasses = (observation.stalledPasses ?? 0) + 1;
  observation.stallCause = cause;
}

export function noteProgress(observation: CasRetentionObservation) {
  delete observation.stalledPasses;
  delete observation.stallCause;
}

/** Names a failure; a permission error anywhere in the pass names its own path. */
export function classifyRetentionFailure(
  error: unknown,
): Pick<CasRetentionObservation, "failure" | "reference"> {
  if (error instanceof CasRetentionBoundError) return { failure: "bound_exceeded" };
  if (error instanceof CasRetentionReferenceError)
    return { failure: error.failure, reference: error.path };
  const errno = error as NodeJS.ErrnoException | null;
  if (errno?.code === "ENOSPC" || errno?.code === "EDQUOT") return { failure: "no_space" };
  if (unreadable(error) && typeof errno?.path === "string")
    return { failure: "unreadable_reference", reference: errno.path };
  return { failure: "failed" };
}

export async function writeObservation(
  storage: ProjectStorage,
  observation: CasRetentionObservation,
): Promise<void> {
  // ADR-0658: the path is recorded relative to the repository, never absolute.
  if (observation.reference !== undefined)
    observation.reference = relative(storage.paths.repositoryRoot, observation.reference);
  await writeRetentionProjection(observationPath(storage), observation);
}

/**
 * The worker's record of a pass that threw past its own handling, such as a full disk while it
 * wrote its observation. If this write fails too, the observation's age still shows in
 * attention, which flags one that is too old.
 */
export async function recordCasRetentionFailure(
  storage: ProjectStorage,
  error: unknown,
): Promise<void> {
  if (storage.readOnly) return;
  const observation = await startObservation(storage);
  await writeObservation(storage, {
    ...observation,
    status: "unavailable",
    remaining: false,
    ...classifyRetentionFailure(error),
  }).catch(() => undefined);
}
