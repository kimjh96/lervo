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
      "Converged 숙의 결과만 지식 후보를 만들 수 있습니다.",
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
      "Converged outcome의 결정 artifact를 찾지 못했습니다.",
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
        "채택 주장마다 현재 digest와 영향 경로가 필요합니다.",
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
        "채택 주장을 검증한 근거가 없습니다.",
      );
    }
    const revisions = uniqueSorted(verifications.map((item) =>
      item.value.repositoryRevision));
    if (revisions.length !== 1) {
      throw new KnowledgeError(
        "candidate_evidence_invalid",
        "verification_revision_mismatch",
        "한 지식 후보의 검증 결과가 서로 다른 repository revision을 가리킵니다.",
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
        "지식 후보가 참조한 evidence event가 현재 event store에 없습니다.",
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
        "생성된 지식 후보가 schema 또는 자기 참조 계약을 통과하지 못했습니다.",
      );
    }
    if (events.some((event) =>
      event.type === "knowledge.candidate.created" &&
      event.payload.candidateId === candidate.candidateId)) {
      throw new KnowledgeError(
        "candidate_contract_invalid",
        "candidate_already_recorded",
        "같은 지식 후보가 이미 event 원본에 기록되어 있습니다.",
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
      "지식 후보 event transaction을 기록하지 못했습니다.",
      { cause: error },
    );
  }
  return drafts.map((draft, index) => ({
    ...draft,
    recordedEvent: recordedEvents[index]!,
  }));
}
