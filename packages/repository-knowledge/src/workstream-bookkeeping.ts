import type { WorkstreamSnapshot } from "@lervo/schemas";

import { canonicalJson, sha256 } from "./integrity.js";

export const MAXIMUM_WORKSTREAM_NOTES = 32;

export type WorkstreamRepositoryHead = NonNullable<WorkstreamSnapshot["repositoryHead"]>;

/**
 * Write-time facts the service owns. Callers never supply them: the service observes the clock and
 * repository HEAD when it plans, and a stale plan is detected by the intent hash, not by these.
 */
export interface WorkstreamBookkeeping {
  recordedAt: string;
  repositoryHead: WorkstreamRepositoryHead | null;
}

/** Fields stamped by the service on every authored write; caller values are ignored. */
const STAMPED_FIELDS = ["updatedAt", "repositoryHead"] as const;

/** Fields carried from the current snapshot unless a caller asserts an equal value. */
export const CARRIED_FIELDS = ["schemaVersion", "workstreamId", "origin"] as const;

export function withoutStampedFields(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  for (const field of STAMPED_FIELDS) delete result[field];
  return result;
}

/**
 * Plan identity binds what the writer intends, not when it was observed, so a reviewed plan can
 * still be applied by a later invocation whose clock and HEAD observation differ.
 */
export function workstreamIntentHash(snapshot: WorkstreamSnapshot): string {
  return sha256(canonicalJson(withoutStampedFields(snapshot as Record<string, unknown>)));
}

export function stampWorkstreamBookkeeping(
  value: Record<string, unknown>,
  bookkeeping: WorkstreamBookkeeping,
): Record<string, unknown> {
  return {
    ...withoutStampedFields(value),
    updatedAt: bookkeeping.recordedAt,
    ...(bookkeeping.repositoryHead === null ? {} : { repositoryHead: bookkeeping.repositoryHead }),
  };
}

/**
 * Notes are ordered oldest first, so the newest notes are kept. The dropped count accumulates on
 * the snapshot so truncation is always visible to the next reader.
 */
export function retainRecentNotes(
  notes: unknown,
  previousDroppedCount: number,
): { notes: unknown; droppedNoteCount: number; droppedThisRevision: number } {
  if (!Array.isArray(notes) || notes.length <= MAXIMUM_WORKSTREAM_NOTES)
    return { notes, droppedNoteCount: previousDroppedCount, droppedThisRevision: 0 };
  const dropped = notes.length - MAXIMUM_WORKSTREAM_NOTES;
  return {
    notes: notes.slice(dropped),
    droppedNoteCount: previousDroppedCount + dropped,
    droppedThisRevision: dropped,
  };
}
