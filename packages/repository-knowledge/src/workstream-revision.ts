import type { WorkstreamSnapshot } from "@lervo/schemas";

import { canonicalJson } from "./integrity.js";
import {
  CARRIED_FIELDS,
  retainRecentNotes,
  stampWorkstreamBookkeeping,
  withoutStampedFields,
  type WorkstreamBookkeeping,
} from "./workstream-bookkeeping.js";

/**
 * An authored workstream change. `snapshot` replaces every semantic field; `patch` is an RFC 7386
 * JSON merge patch over the current snapshot (objects merge, arrays replace, `null` deletes), with
 * one extension: a top-level `appendNotes` string array is appended after the merged notes.
 */
export type WorkstreamChange =
  { kind: "snapshot"; value: unknown } | { kind: "patch"; value: unknown };

export interface WorkstreamRevisionBlocker {
  code: "invalid_patch" | "invalid_revision" | "identity_changed" | "origin_changed";
  message: string;
}

export interface WorkstreamRevisionDerivation {
  /** The complete desired snapshot candidate; schema validation remains the planner's job. */
  snapshot: Record<string, unknown> | null;
  droppedNotesThisRevision: number;
  blockers: WorkstreamRevisionBlocker[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** RFC 7386 JSON Merge Patch. */
export function applyJsonMergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch;
  const result: Record<string, unknown> = isRecord(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = applyJsonMergePatch(result[key], value);
  }
  return result;
}

function patchedContent(
  current: WorkstreamSnapshot,
  patch: unknown,
): { value: Record<string, unknown> | null; blockers: WorkstreamRevisionBlocker[] } {
  if (!isRecord(patch))
    return {
      value: null,
      blockers: [{ code: "invalid_patch", message: "A workstream patch must be a JSON object." }],
    };
  const { appendNotes, ...mergePatch } = patch;
  if (
    appendNotes !== undefined &&
    (!Array.isArray(appendNotes) || appendNotes.some((note) => typeof note !== "string"))
  )
    return {
      value: null,
      blockers: [{ code: "invalid_patch", message: "appendNotes must be an array of strings." }],
    };
  const merged = applyJsonMergePatch(current, mergePatch) as Record<string, unknown>;
  if (appendNotes !== undefined)
    merged.notes = [...(Array.isArray(merged.notes) ? merged.notes : []), ...appendNotes];
  return { value: merged, blockers: [] };
}

/**
 * Derives the next revision from the verified current snapshot. The service owns revision,
 * update time, observed HEAD, and note retention; identity and origin are carried and may only be
 * asserted unchanged. An explicit revision is an optimistic-concurrency assertion of current + 1.
 */
export function deriveWorkstreamRevision(input: {
  current: WorkstreamSnapshot;
  change: WorkstreamChange;
  bookkeeping: WorkstreamBookkeeping;
}): WorkstreamRevisionDerivation {
  const { current, change } = input;
  const supplied =
    change.kind === "patch"
      ? patchedContent(current, change.value)
      : isRecord(change.value)
        ? { value: { ...change.value }, blockers: [] }
        : {
            value: null,
            blockers: [
              {
                code: "invalid_patch" as const,
                message: "A workstream snapshot must be a JSON object.",
              },
            ],
          };
  if (supplied.value === null)
    return { snapshot: null, droppedNotesThisRevision: 0, blockers: supplied.blockers };
  const explicit = isRecord(change.value) ? change.value : {};
  const blockers: WorkstreamRevisionBlocker[] = [];
  if (explicit.revision !== undefined && explicit.revision !== current.revision + 1)
    blockers.push({
      code: "invalid_revision",
      message: `The supplied revision must be omitted or equal ${current.revision + 1}; the current revision is ${current.revision}.`,
    });
  if (
    explicit.workstreamId !== undefined &&
    canonicalJson(explicit.workstreamId) !== canonicalJson(current.workstreamId)
  )
    blockers.push({
      code: "identity_changed",
      message: "A workstream update cannot change workstreamId.",
    });
  if (
    explicit.origin !== undefined &&
    canonicalJson(supplied.value.origin) !== canonicalJson(current.origin)
  )
    blockers.push({
      code: "origin_changed",
      message: "A workstream update cannot rewrite origin evidence.",
    });
  const content = withoutStampedFields(supplied.value);
  for (const field of CARRIED_FIELDS) {
    if (field === "schemaVersion" && content.schemaVersion !== undefined) continue;
    content[field] = current[field];
  }
  content.revision = current.revision + 1;
  delete content.droppedNoteCount;
  const retained = retainRecentNotes(content.notes, current.droppedNoteCount ?? 0);
  content.notes = retained.notes;
  if (retained.droppedNoteCount > 0) content.droppedNoteCount = retained.droppedNoteCount;
  return {
    snapshot: stampWorkstreamBookkeeping(content, input.bookkeeping),
    droppedNotesThisRevision: retained.droppedThisRevision,
    blockers,
  };
}
