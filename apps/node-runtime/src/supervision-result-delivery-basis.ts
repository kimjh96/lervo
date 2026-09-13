import { assertNativePublicationJudgement } from "./supervision-publication-judgement.js";
import type {
  OperatingActionPlanV1,
  SupervisedGoalCompletionV1,
  SupervisedResultDelivery,
} from "@lervo/application-contract";
import { assertConversationOutboundMessage } from "@lervo/conversation-contract";
import type { ConversationReplyCandidate } from "@lervo/interaction";
import type { ConversationOutboundMessage } from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { isSupervisedAssignmentAccepted, operatingContractHash } from "@lervo/work-controller";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import {
  expectedGoalCompletion,
  inspectGoalCompletion,
} from "./supervision-goal-completion-receipt.js";
import {
  resultWritingContract,
  verifyConversationResultCandidate,
} from "./conversation-result-publication.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import type { observeSupervisionTasks } from "./supervision-task-observation.js";

/** Only the exact accepted result and semantic publication permit can enter the delivery queue. */
export async function readCanonicalResultDelivery(input: {
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  observed: Awaited<ReturnType<typeof observeSupervisionTasks>>;
  effect: SupervisedResultDelivery;
  artifacts: ArtifactStore;
  events: EventStore;
}) {
  const { effect, artifacts, events, source, observed } = input;
  const completionPlan = (await readSupervisionJsonArtifact(
    artifacts,
    effect.completionPlanHash,
  )) as OperatingActionPlanV1;
  const completion = (await readSupervisionJsonArtifact(
    artifacts,
    completionPlan.effectHash,
  )) as SupervisedGoalCompletionV1;
  const expected = await expectedGoalCompletion({ events, artifacts }, completionPlan, completion);
  const receipt = await inspectGoalCompletion({ events, artifacts }, completionPlan, completion);
  if (
    receipt.status !== "confirmed" ||
    !receipt.eventIds.includes(effect.completionEventId) ||
    completion.ownerAgentId !== effect.ownerAgentId ||
    completion.workstreamId !== effect.workstreamId ||
    source.workstreamHash !== expected.snapshotHash ||
    source.workstream.status !== "completed" ||
    effect.resultArtifactHash !== completion.resultArtifactHash ||
    observed.unboundAssignmentIds.length > 0 ||
    observed.assignments.length !== completion.assignmentReviews.length ||
    !observed.assignments.every(
      (item) =>
        isSupervisedAssignmentAccepted(item) &&
        completion.assignmentReviews.some(
          (review) =>
            review.assignmentId === item.assignmentId &&
            review.assignmentRevision === item.revision &&
            review.reviewEventId === item.review?.eventId,
        ),
    )
  )
    throw new Error("Result publication requires unchanged canonical goal acceptance.");
  const candidate = (await readSupervisionJsonArtifact(
    artifacts,
    effect.candidateArtifactHash,
  )) as ConversationReplyCandidate;
  const outbound = (await readSupervisionJsonArtifact(
    artifacts,
    effect.outboundArtifactHash,
  )) as ConversationOutboundMessage;
  assertConversationOutboundMessage({ outbound });
  if (
    candidate.publicationPermit.writingPolicyId !== resultWritingContract.writingPolicyId ||
    candidate.publicationEvidence.artifact.contentHash !== effect.resultArtifactHash ||
    operatingContractHash(candidate.content) !== operatingContractHash(outbound.content) ||
    operatingContractHash(candidate.publicationPermit) !==
      operatingContractHash(outbound.publicationPermit)
  )
    throw new Error("The queued publication differs from its exact accepted result.");
  await verifyConversationResultCandidate({ artifacts, candidate });
  if (effect.schemaVersion === 2)
    await assertNativePublicationJudgement({
      events,
      artifacts,
      effect,
      completionPlan,
      candidate,
    });
  return { outbound, candidate };
}
