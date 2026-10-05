import { validateSchema, type WorkstreamSnapshot } from "@lervo/schemas";

import { stableId } from "./integrity.js";
import {
  retainRecentNotes,
  stampWorkstreamBookkeeping,
  withoutStampedFields,
  type WorkstreamBookkeeping,
} from "./workstream-bookkeeping.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function pendingCoordinatesValid(snapshot: WorkstreamSnapshot): boolean {
  const decisions = snapshot.pendingDecisions ?? [];
  const approvals = snapshot.pendingApprovals ?? [];
  if (new Set(decisions.map((item) => item.decisionId)).size !== decisions.length) return false;
  if (new Set(approvals.map((item) => item.approvalId)).size !== approvals.length) return false;
  return decisions.every((item) => {
    const choiceIds = item.choices.map((choice) => choice.choiceId);
    return (
      new Set(choiceIds).size === choiceIds.length &&
      (item.recommendedChoiceId === null || choiceIds.includes(item.recommendedChoiceId))
    );
  });
}

function normalizedStartDraft(value: Record<string, unknown>): Record<string, unknown> {
  return {
    ...value,
    pendingDecisions: value.pendingDecisions ?? [],
    pendingApprovals: value.pendingApprovals ?? [],
  };
}

function snapshotIdentity(
  projectId: string,
  draft: Record<string, unknown>,
  predecessor: { workstreamId: string; contentHash: string } | null,
): { workstreamId: string } {
  const normalizedDraft = normalizedStartDraft(draft);
  return {
    workstreamId: stableId(
      "wks",
      predecessor === null
        ? { projectId, draft: normalizedDraft }
        : { projectId, draft: normalizedDraft, predecessor },
    ),
  };
}

/**
 * Without bookkeeping the draft is exact, including its caller-supplied `updatedAt`, which then
 * participates in identity. With bookkeeping the service stamps update time and HEAD, retains the
 * newest notes, and derives identity from the semantic draft alone so plan and apply agree.
 */
export function snapshotFromStartDraft(
  projectId: string,
  value: unknown,
  predecessor: { workstreamId: string; contentHash: string } | null,
  bookkeeping: WorkstreamBookkeeping | null = null,
): WorkstreamSnapshot | null {
  if (!isRecord(value)) return null;
  if (bookkeeping !== null) {
    const { droppedNoteCount: _callerDroppedCount, ...supplied } = withoutStampedFields(value);
    const retained = retainRecentNotes(supplied.notes, 0);
    const semantic = { ...supplied, notes: retained.notes };
    const exact = snapshotFromStartDraft(
      projectId,
      { ...semantic, updatedAt: bookkeeping.recordedAt },
      predecessor,
    );
    if (exact === null) return null;
    const { workstreamId } = snapshotIdentity(projectId, semantic, predecessor);
    const stamped = stampWorkstreamBookkeeping(
      {
        ...exact,
        workstreamId,
        ...(retained.droppedNoteCount > 0 ? { droppedNoteCount: retained.droppedNoteCount } : {}),
      },
      bookkeeping,
    );
    return validateSchema("workstreamSnapshot", stamped).valid
      ? (stamped as WorkstreamSnapshot)
      : null;
  }
  const allowed = new Set([
    "schemaVersion",
    "status",
    "title",
    "objective",
    "nextActions",
    "blockers",
    "notes",
    "references",
    "pendingDecisions",
    "pendingApprovals",
    "updatedAt",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  const normalizedDraft = normalizedStartDraft(value);
  const snapshot = {
    ...normalizedDraft,
    ...snapshotIdentity(projectId, value, predecessor),
    revision: 1,
    origin: {
      kind: predecessor === null ? ("created" as const) : ("successor" as const),
      sourceArtifactId: null,
      sourceContentHash: null,
      sourcePathDigest: null,
      ...(predecessor === null
        ? {}
        : {
            predecessorWorkstreamId: predecessor.workstreamId,
            predecessorSnapshotContentHash: predecessor.contentHash,
          }),
    },
  };
  return validateSchema("workstreamSnapshot", snapshot).valid &&
    pendingCoordinatesValid(snapshot as WorkstreamSnapshot)
    ? (snapshot as WorkstreamSnapshot)
    : null;
}

/** Creates the same exact-hash successor snapshot without changing the default selection. */
export function createWorkstreamSuccessorSnapshot(input: {
  projectId: string;
  draft: unknown;
  predecessor: { workstreamId: string; contentHash: string };
}): WorkstreamSnapshot | null {
  return snapshotFromStartDraft(input.projectId, input.draft, input.predecessor);
}
