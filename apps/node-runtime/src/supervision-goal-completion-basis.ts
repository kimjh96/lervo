import type { SupervisedGoalCompletionV1 } from "@lervo/application-contract";
import type { ArtifactStore } from "@lervo/storage-contract";
import { isSupervisedAssignmentAccepted, operatingContractHash } from "@lervo/work-controller";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import type { observeSupervisionTasks } from "./supervision-task-observation.js";
import { readSupervisionTextArtifact } from "./supervision-artifact-json.js";

/** Completion binds the current goal and every accepted responsibility, including review identity. */
export async function assertCanonicalGoalCompletionBasis(input: {
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  observed: Awaited<ReturnType<typeof observeSupervisionTasks>>;
  effect: SupervisedGoalCompletionV1;
  artifacts: ArtifactStore;
}) {
  const { source, observed, effect } = input;
  const goal = source.workstream;
  const reviews = observed.assignments
    .map((item) => ({
      assignmentId: item.assignmentId,
      assignmentRevision: item.revision,
      reviewEventId: item.review?.eventId,
    }))
    .sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
  if (
    goal.status !== "active" ||
    goal.workstreamId !== effect.workstreamId ||
    goal.revision !== effect.workstreamRevision ||
    source.workstreamHash !== effect.workstreamSnapshotHash ||
    goal.blockers.length > 0 ||
    (goal.pendingDecisions?.length ?? 0) > 0 ||
    (goal.pendingApprovals?.length ?? 0) > 0 ||
    observed.unboundAssignmentIds.length > 0 ||
    observed.assignments.length === 0 ||
    !observed.assignments.every(isSupervisedAssignmentAccepted) ||
    operatingContractHash(reviews) !==
      operatingContractHash(
        [...effect.assignmentReviews].sort((a, b) => a.assignmentId.localeCompare(b.assignmentId)),
      )
  )
    throw new Error("The goal completion has unresolved or changed canonical acceptance.");
  if (
    (await readSupervisionTextArtifact(input.artifacts, effect.resultArtifactHash)).trim()
      .length === 0
  )
    throw new Error("The goal completion result is empty.");
}
