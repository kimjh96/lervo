// Coordinate checks a payload's schema cannot state, applied after the schema accepted it: an
// artifact ID that must name its content hash, counts that must agree with their lists. One entry per
// event type, so `sanitizeEventPayload` dispatches without a chain of type comparisons.
import type {
  AgentContextHandoffRecordedEventPayload,
  AgentContextPromotedEventPayload,
  AssignmentCompletionPreparedEventPayload,
  AssignmentCompletionReconciledEventPayload,
  ConversationRepositoryWorkCompletedEventPayload,
  DeliberationArtifactRecordedEventPayload,
  KnowledgeCandidateCreatedEventPayload,
  KnowledgeCandidateReviewedEventPayload,
  KnowledgeReconciliationReviewedEventPayload,
  KnowledgeStaleDetectedEventPayload,
  KnowledgeVerifiedEventPayload,
  ResourceUsageRecordedEventPayload,
  RunCompletedEventPayload,
  VerificationCompletedEventPayload,
  WorkstreamSnapshotRecordedEventPayload,
  EventType,
} from "@lervo/schemas";

function conversationRepositoryWorkCoordinateMatches(
  payload: ConversationRepositoryWorkCompletedEventPayload,
): boolean {
  if (payload.changedPathCount < payload.changedPaths.length) return false;
  if (
    payload.knowledgeDisposition === "pending_background" &&
    payload.changedPathCount !== payload.changedPaths.length
  )
    return false;
  return payload.changedPathCount === 0
    ? payload.changedPaths.length === 0 &&
        payload.repositoryRevisionBefore === payload.repositoryRevisionAfter
    : payload.repositoryRevisionBefore !== payload.repositoryRevisionAfter;
}

function deliberationArtifactCoordinateMatches(
  payload: DeliberationArtifactRecordedEventPayload,
): boolean {
  if (payload.artifactId !== `art_${payload.contentHash.slice("sha256:".length)}`) return false;
  const artifact = payload.artifact;
  return (
    artifact === undefined ||
    (artifact.deliberationId === payload.deliberationId &&
      artifact.deliberationArtifactId === payload.deliberationArtifactId &&
      artifact.kind === payload.kind &&
      artifact.round === payload.round &&
      artifact.producer.roleId === payload.producerRoleId &&
      artifact.content.artifactId === payload.artifactId &&
      artifact.content.contentHash === payload.contentHash &&
      artifact.writingPublicationPermit.permitId === payload.writingPermitId)
  );
}

function agentContextPromotionCoordinateMatches(
  payload: AgentContextPromotedEventPayload,
): boolean {
  return (
    payload.summaryArtifactId === `art_${payload.summaryContentHash.slice("sha256:".length)}` &&
    (payload.source.kind !== "artifact" ||
      payload.source.sourceId === `art_${payload.source.contentHash.slice("sha256:".length)}`)
  );
}

function agentContextHandoffCoordinateMatches(
  payload: AgentContextHandoffRecordedEventPayload,
): boolean {
  return (
    payload.manifestArtifactId === `art_${payload.manifestContentHash.slice("sha256:".length)}`
  );
}

function knowledgeCandidateCoordinateMatches(
  payload: KnowledgeCandidateCreatedEventPayload,
): boolean {
  return (
    payload.candidateArtifactId === `art_${payload.candidateContentHash.slice("sha256:".length)}`
  );
}

function workstreamCoordinateMatches(payload: WorkstreamSnapshotRecordedEventPayload): boolean {
  return (
    payload.snapshotArtifactId === `art_${payload.snapshotContentHash.slice("sha256:".length)}` &&
    (payload.sourceArtifactId === null
      ? payload.sourceContentHash === null
      : payload.sourceContentHash !== null &&
        payload.sourceArtifactId === `art_${payload.sourceContentHash.slice("sha256:".length)}`) &&
    (["legacy_handoff_migration", "legacy_continuation_migration"].includes(payload.changeKind)
      ? payload.sourceArtifactId !== null && payload.sourceContentHash !== null
      : payload.sourceArtifactId === null && payload.sourceContentHash === null)
  );
}

function reviewCoordinateMatches(payload: KnowledgeCandidateReviewedEventPayload): boolean {
  return (
    payload.approvalArtifactId === `art_${payload.approvalContentHash.slice("sha256:".length)}`
  );
}

function reconciliationReviewCoordinateMatches(
  payload: KnowledgeReconciliationReviewedEventPayload,
): boolean {
  const accepted = new Set(payload.acceptedDispositionIds);
  const listedCount = payload.acceptedDispositionIds.length + payload.skippedDispositionIds.length;
  return (
    payload.reviewArtifactId === `art_${payload.reviewArtifactHash.slice("sha256:".length)}` &&
    payload.skippedDispositionIds.every((id) => !accepted.has(id)) &&
    listedCount <= 256 &&
    payload.dispositionCount >= listedCount &&
    payload.dispositionListTruncated === payload.dispositionCount > listedCount &&
    (payload.decision === "approved"
      ? payload.acceptedDispositionIds.length > 0
      : payload.acceptedDispositionIds.length === 0)
  );
}

function verifiedCoordinateMatches(payload: KnowledgeVerifiedEventPayload): boolean {
  return (
    payload.knowledgeArtifactId === `art_${payload.knowledgeContentHash.slice("sha256:".length)}`
  );
}

function staleCoordinateMatches(payload: KnowledgeStaleDetectedEventPayload): boolean {
  return payload.resultArtifactId === `art_${payload.resultContentHash.slice("sha256:".length)}`;
}

function verificationCoordinateMatches(payload: VerificationCompletedEventPayload): boolean {
  return payload.resultArtifactId === `art_${payload.resultContentHash.slice("sha256:".length)}`;
}

function runCompletedCoordinateMatches(payload: RunCompletedEventPayload): boolean {
  const resultArtifactId = `art_${payload.resultDigest.slice("sha256:".length)}`;
  return (
    payload.artifactIds.includes(resultArtifactId) &&
    (payload.verificationStatus === "not_run"
      ? payload.artifactIds.length === 1
      : payload.artifactIds.length >= 2)
  );
}

function assignmentCompletionPreparedCoordinateMatches(
  payload: AssignmentCompletionPreparedEventPayload,
): boolean {
  return payload.resultArtifactId === `art_${payload.resultContentHash.slice("sha256:".length)}`;
}

function assignmentCompletionReconciledCoordinateMatches(
  payload: AssignmentCompletionReconciledEventPayload,
): boolean {
  return payload.resultArtifactId === `art_${payload.resultContentHash.slice("sha256:".length)}`;
}

function resourceUsageCoordinateMatches(payload: ResourceUsageRecordedEventPayload): boolean {
  return (
    payload.usage === null ||
    (payload.usage.cachedInputTokens + (payload.cacheCreationInputTokens ?? 0) <=
      payload.usage.inputTokens &&
      payload.usage.reasoningOutputTokens <= payload.usage.outputTokens &&
      payload.usage.totalTokens === payload.usage.inputTokens + payload.usage.outputTokens)
  );
}

type Validator = (payload: never) => boolean;

/** Each event type's coordinate check; a type without one has no coordinates beyond its schema. */
const validators: Partial<Record<EventType, Validator>> = {
  "deliberation.artifact.recorded": deliberationArtifactCoordinateMatches,
  "knowledge.candidate.created": knowledgeCandidateCoordinateMatches,
  "knowledge.candidate.reviewed": reviewCoordinateMatches,
  "knowledge.reconciliation.reviewed": reconciliationReviewCoordinateMatches,
  "knowledge.verified": verifiedCoordinateMatches,
  "knowledge.stale.detected": staleCoordinateMatches,
  "verification.completed": verificationCoordinateMatches,
  "run.completed": runCompletedCoordinateMatches,
  "assignment.completion.prepared": assignmentCompletionPreparedCoordinateMatches,
  "conversation.repository_work.completed": conversationRepositoryWorkCoordinateMatches,
  "assignment.completion.reconciled": assignmentCompletionReconciledCoordinateMatches,
  "workstream.snapshot.recorded": workstreamCoordinateMatches,
  "resource.usage.recorded": resourceUsageCoordinateMatches,
  "agent.context.promoted": agentContextPromotionCoordinateMatches,
  "agent.context.handoff.recorded": agentContextHandoffCoordinateMatches,
};

export const payloadCoordinateValidators = validators as Partial<
  Record<EventType, (payload: Readonly<Record<string, unknown>>) => boolean>
>;
