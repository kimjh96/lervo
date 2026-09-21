import { validateSchema, type WorkstreamSnapshot } from "@lervo/schemas";

import { stableId } from "./integrity.js";

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

export function snapshotFromStartDraft(
  projectId: string,
  value: unknown,
  predecessor: { workstreamId: string; contentHash: string } | null,
): WorkstreamSnapshot | null {
  if (!isRecord(value)) return null;
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
  const normalizedDraft = {
    ...value,
    pendingDecisions: value.pendingDecisions ?? [],
    pendingApprovals: value.pendingApprovals ?? [],
  };
  const snapshot = {
    ...normalizedDraft,
    workstreamId: stableId(
      "wks",
      predecessor === null
        ? { projectId, draft: normalizedDraft }
        : { projectId, draft: normalizedDraft, predecessor },
    ),
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
