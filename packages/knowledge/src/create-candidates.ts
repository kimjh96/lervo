import { validateDeliberationOutcome } from "@lervo/deliberation";
import {
  validateSchema,
  type EventEnvelope,
  type KnowledgeCandidate,
} from "@lervo/schemas";

import {
  currentClaims,
  recordedArtifactEvent,
  uniqueSorted,
  validateOutcomeEvent,
  verificationEvidenceForClaim,
  verifyDecisionContent,
} from "./candidate-evidence.js";
import { storeCandidate } from "./candidate-storage.js";
import { calculateKnowledgeCandidateId } from "./integrity.js";
import {
  type CreatedKnowledgeCandidate,
  type CreateKnowledgeCandidatesInput,
  KnowledgeError,
} from "./types.js";

export async function createKnowledgeCandidates(
  input: CreateKnowledgeCandidatesInput,
): Promise<CreatedKnowledgeCandidate[]> {
  validateDeliberationOutcome({
    deliberationId: input.deliberationId,
    policy: input.policy,
    artifacts: input.artifacts,
    verificationEvidence: input.verificationEvidence,
    outcome: input.outcome,
  });
  if (input.outcome.status !== "converged") {
    throw new KnowledgeError(
      "candidate_not_eligible",
      "outcome_not_converged",
      "Only a converged deliberation result can create knowledge candidates.",
    );
  }
  validateOutcomeEvent(input);
  const artifactsById = new Map(input.artifacts.map((artifact) => [
    artifact.deliberationArtifactId,
    artifact,
  ]));
  const decision = artifactsById.get(input.outcome.decisionArtifactId);
  if (decision?.kind !== "decision") {
    throw new KnowledgeError(
      "candidate_evidence_invalid",
      "decision_artifact_missing",
      "The decision artifact for the converged outcome was not found.",
    );
  }
  await verifyDecisionContent(input, decision);
  const evidenceByVerificationId = new Map(input.verificationEvidence.map((item) => [
    item.result.verificationId,
    item,
  ]));
  const claims = currentClaims(input.artifacts);
  const events = input.events.list();
  const decisionEvent = recordedArtifactEvent(events, decision);
  const drafts: Array<{
    candidate: KnowledgeCandidate;
    candidateArtifact: Awaited<ReturnType<typeof storeCandidate>>;
  }> = [];

  for (const claimId of decision.details.adoptedClaimIds) {
    const claimDigest = claims.get(claimId);
    const paths = uniqueSorted(input.pathsByClaimId[claimId] ?? []);
    if (claimDigest === undefined || paths.length === 0) {
      throw new KnowledgeError(
        "candidate_contract_invalid",
        "claim_path_missing",
        "Every accepted claim requires a current digest and impact paths.",
      );
    }
    const verifications = verificationEvidenceForClaim({
      claimId,
      decision,
      artifactsById,
      evidenceByVerificationId,
    });
    if (verifications.length === 0) {
      throw new KnowledgeError(
        "candidate_evidence_invalid",
        "verification_evidence_missing",
        "There is no evidence verifying the accepted claim.",
      );
    }
    const revisions = uniqueSorted(verifications.map((item) =>
      item.value.repositoryRevision));
    if (revisions.length !== 1) {
      throw new KnowledgeError(
        "candidate_evidence_invalid",
        "verification_revision_mismatch",
        "Verification results for one knowledge candidate reference different repository revisions.",
      );
    }
    const verificationEvents = verifications.map((item) =>
      recordedArtifactEvent(events, item.verificationArtifact));
    const evidenceEventIds = uniqueSorted([
      input.outcomeEvent.eventId,
      decisionEvent.eventId,
      ...verificationEvents.map((event) => event.eventId),
      ...decision.evidenceEventIds,
      ...verifications.flatMap((item) => item.verificationArtifact.evidenceEventIds),
    ]);
    if (evidenceEventIds.some((eventId) => input.events.get(eventId) === null)) {
      throw new KnowledgeError(
        "candidate_evidence_invalid",
        "evidence_event_missing",
        "An evidence event referenced by the knowledge candidate is missing from the current event store.",
      );
    }
    const withoutId = {
      schemaVersion: 1 as const,
      projectId: input.outcome.projectId,
      status: "candidate" as const,
      claim: { claimId, claimDigest },
      source: {
        kind: "converged_deliberation" as const,
        deliberationId: input.outcome.deliberationId,
        outcomeId: input.outcome.outcomeId,
        decisionArtifactId: decision.deliberationArtifactId,
        decisionContent: structuredClone(decision.content),
      },
      paths,
      evidence: {
        eventIds: evidenceEventIds,
        verifications: verifications.map((item) => item.value),
      },
      verifiedRevision: revisions[0]!,
      reviewIntervalDays: input.reviewIntervalDays,
      conflictCandidateIds: uniqueSorted(
        input.conflictCandidateIdsByClaimId?.[claimId] ?? [],
      ),
      createdAt: input.outcome.completedAt,
    };
    const candidate = {
      ...withoutId,
      candidateId: calculateKnowledgeCandidateId(withoutId as Omit<KnowledgeCandidate, "candidateId">),
    } as KnowledgeCandidate;
    if (
      !validateSchema("knowledgeCandidate", candidate).valid ||
      candidate.conflictCandidateIds.includes(candidate.candidateId)
    ) {
      throw new KnowledgeError(
        "candidate_contract_invalid",
        "candidate_schema_invalid",
        "The generated knowledge candidate does not satisfy its schema or self-reference contract.",
      );
    }
    if (events.some((event) =>
      event.type === "knowledge.candidate.created" &&
      event.payload.candidateId === candidate.candidateId)) {
      throw new KnowledgeError(
        "candidate_contract_invalid",
        "candidate_already_recorded",
        "The same knowledge candidate is already recorded in the event source.",
      );
    }
    drafts.push({ candidate, candidateArtifact: await storeCandidate(input, candidate) });
  }

  let recordedEvents: EventEnvelope[];
  try {
    recordedEvents = input.events.transact((transaction) => drafts.map((draft, index) =>
      transaction.append({
        eventId: input.createEventId(),
        projectId: input.outcome.projectId,
        runId: decision.producer.runId,
        sessionId: decision.producer.sessionId,
        type: "knowledge.candidate.created",
        occurredAt: input.outcome.completedAt,
        actor: { kind: "agent", provider: decision.producer.provider },
        schemaVersion: 1,
        policyVersion: input.policyVersion,
        payload: {
          candidateId: draft.candidate.candidateId,
          claimDigest: draft.candidate.claim.claimDigest,
          paths: draft.candidate.paths,
          evidenceIds: draft.candidate.evidence.eventIds,
          sourceOutcomeId: draft.candidate.source.outcomeId,
          decisionArtifactId: draft.candidate.source.decisionArtifactId,
          verificationArtifactIds: draft.candidate.evidence.verifications.map((item) =>
            item.verificationArtifactId),
          verifiedRevision: draft.candidate.verifiedRevision,
          candidateArtifactId: draft.candidateArtifact.artifactId,
          candidateContentHash: draft.candidateArtifact.contentHash,
        },
      }).event));
  } catch (error) {
    throw new KnowledgeError(
      "event_recording_failed",
      "event_store_failed",
      "Could not record the knowledge candidate event transaction.",
      { cause: error },
    );
  }
  return drafts.map((draft, index) => ({
    ...draft,
    recordedEvent: recordedEvents[index]!,
  }));
}
