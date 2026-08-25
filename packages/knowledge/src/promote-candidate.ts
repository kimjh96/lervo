import { validateSchema, type VerifiedKnowledge } from "@lervo/schemas";

import { storeKnowledgeArtifact } from "./artifact-storage.js";
import { calculateVerifiedKnowledgeId, verifiedKnowledgeBytes } from "./integrity.js";
import { validatePromotionInput } from "./promotion-validation.js";
import {
  KnowledgeError,
  type KnowledgeArtifactCoordinate,
  type PromoteKnowledgeCandidateInput,
  type PromotedKnowledge,
} from "./types.js";

function artifactCoordinate(value: KnowledgeArtifactCoordinate): KnowledgeArtifactCoordinate {
  return {
    artifactId: value.artifactId,
    uri: value.uri,
    contentHash: value.contentHash,
    byteCount: value.byteCount,
  };
}

export async function promoteKnowledgeCandidate(
  input: PromoteKnowledgeCandidateInput,
): Promise<PromotedKnowledge> {
  const { candidateEvent, reviewEvent } = await validatePromotionInput(input);
  const content = {
    schemaVersion: 1 as const,
    projectId: input.candidate.projectId,
    status: "verified" as const,
    candidate: {
      candidateId: input.candidate.candidateId,
      artifact: artifactCoordinate(input.candidateArtifact),
    },
    approval: {
      approvalId: input.review.approval.approvalId,
      artifact: artifactCoordinate(input.review.approvalArtifact),
    },
    claim: structuredClone(input.candidate.claim),
    paths: input.candidate.paths.map((path) => ({
      path,
      contentHash: input.currentSnapshot.files[path]!,
    })),
    evidenceEventIds: [
      ...new Set([
        ...input.candidate.evidence.eventIds,
        candidateEvent.eventId,
        reviewEvent.eventId,
      ]),
    ].sort(),
    verifiedRevision: input.currentSnapshot.revision,
    reviewIntervalDays: input.candidate.reviewIntervalDays,
    verifiedAt: input.review.approval.reviewedAt,
  };
  const knowledge = {
    ...content,
    knowledgeId: calculateVerifiedKnowledgeId(content as Omit<VerifiedKnowledge, "knowledgeId">),
  } as VerifiedKnowledge;
  if (!validateSchema("verifiedKnowledge", knowledge).valid) {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "knowledge_schema_invalid",
      "The verified knowledge source does not satisfy the schema.",
    );
  }
  if (
    input.events
      .list()
      .some(
        (event) =>
          event.type === "knowledge.verified" &&
          (event.payload.knowledgeId === knowledge.knowledgeId ||
            event.payload.candidateId === input.candidate.candidateId),
      )
  ) {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "knowledge_already_recorded",
      "Verified knowledge for the same candidate is already recorded in an event.",
    );
  }
  const knowledgeArtifact = await storeKnowledgeArtifact({
    artifactStore: input.artifactStore,
    bytes: verifiedKnowledgeBytes(knowledge),
    mismatchReason: "knowledge_artifact_mismatch",
    label: "verified knowledge",
  });
  try {
    const recordedEvent = input.events.append({
      eventId: input.createEventId(),
      projectId: knowledge.projectId,
      runId: reviewEvent.runId,
      sessionId: reviewEvent.sessionId,
      type: "knowledge.verified",
      occurredAt: knowledge.verifiedAt,
      actor: { kind: "system" },
      schemaVersion: 1,
      policyVersion: input.policyVersion,
      payload: {
        knowledgeId: knowledge.knowledgeId,
        candidateId: knowledge.candidate.candidateId,
        candidateContentHash: knowledge.candidate.artifact.contentHash,
        approvalId: knowledge.approval.approvalId,
        approvalContentHash: knowledge.approval.artifact.contentHash,
        claimDigest: knowledge.claim.claimDigest,
        paths: knowledge.paths.map((item) => item.path),
        verifiedRevision: knowledge.verifiedRevision,
        knowledgeArtifactId: knowledgeArtifact.artifactId,
        knowledgeContentHash: knowledgeArtifact.contentHash,
      },
    }).event;
    return { knowledge, knowledgeArtifact, recordedEvent };
  } catch (error) {
    throw new KnowledgeError(
      "event_recording_failed",
      "event_store_failed",
      "Could not record the verified knowledge event.",
      { cause: error },
    );
  }
}
