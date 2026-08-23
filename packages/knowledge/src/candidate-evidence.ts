import type { DeliberationArtifact, EventEnvelope } from "@lervo/schemas";

import { knowledgeSha256 } from "./integrity.js";
import { type CreateKnowledgeCandidatesInput, KnowledgeError } from "./types.js";

export type DecisionArtifact = Extract<DeliberationArtifact, { kind: "decision" }>;
type VerificationArtifact = Extract<DeliberationArtifact, { kind: "verification" }>;

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export function validateOutcomeEvent(input: CreateKnowledgeCandidatesInput): void {
  const event = input.outcomeEvent;
  const stored = input.events.get(event.eventId);
  if (stored === null || stored.eventHash !== event.eventHash) {
    throw new KnowledgeError(
      "candidate_evidence_invalid",
      "outcome_event_mismatch",
      "The deliberation completion event differs from the current event store source.",
    );
  }
  if (
    event.type !== "deliberation.completed" ||
    event.projectId !== input.outcome.projectId ||
    event.payload.deliberationId !== input.outcome.deliberationId ||
    event.payload.outcomeId !== input.outcome.outcomeId ||
    event.payload.status !== "converged" ||
    event.payload.decisionArtifactId !== input.outcome.decisionArtifactId
  ) {
    throw new KnowledgeError(
      "candidate_evidence_invalid",
      "outcome_event_mismatch",
      "The knowledge candidate deliberation completion event coordinates differ from the converged outcome.",
    );
  }
}

export function currentClaims(
  artifacts: readonly DeliberationArtifact[],
): Map<string, string> {
  const claims = new Map<string, string>();
  for (const artifact of artifacts) {
    if (artifact.kind !== "proposal" && artifact.kind !== "revision") continue;
    for (const claim of artifact.details.claims) claims.set(claim.claimId, claim.claimDigest);
  }
  return claims;
}

export function recordedArtifactEvent(
  events: readonly EventEnvelope[],
  artifact: DeliberationArtifact,
): EventEnvelope {
  const matches = events.filter((event) =>
    event.type === "deliberation.artifact.recorded" &&
    event.payload.deliberationArtifactId === artifact.deliberationArtifactId &&
    event.payload.artifactId === artifact.content.artifactId &&
    event.payload.contentHash === artifact.content.contentHash
  );
  if (matches.length !== 1) {
    throw new KnowledgeError(
      "candidate_evidence_invalid",
      "evidence_event_missing",
      "Exactly one recorded event for the decision or verification artifact cannot be verified.",
    );
  }
  return matches[0]!;
}

export async function verifyDecisionContent(
  input: CreateKnowledgeCandidatesInput,
  decision: DecisionArtifact,
): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = await input.artifactStore.get(decision.content.uri);
  } catch (error) {
    throw new KnowledgeError(
      "candidate_evidence_invalid",
      "decision_content_unavailable",
      "Could not read the decision artifact source from CAS.",
      { cause: error },
    );
  }
  if (
    bytes.byteLength !== decision.content.byteCount ||
    knowledgeSha256(bytes) !== decision.content.contentHash ||
    decision.content.artifactId !== `art_${decision.content.contentHash.slice(7)}` ||
    decision.content.uri !== `lervo-cas://sha256/${decision.content.contentHash.slice(7)}`
  ) {
    throw new KnowledgeError(
      "candidate_evidence_invalid",
      "candidate_artifact_mismatch",
      "The decision artifact CAS bytes and coordinates differ.",
    );
  }
}

export function verificationEvidenceForClaim(input: {
  claimId: string;
  decision: DecisionArtifact;
  artifactsById: ReadonlyMap<string, DeliberationArtifact>;
  evidenceByVerificationId: ReadonlyMap<
    string,
    CreateKnowledgeCandidatesInput["verificationEvidence"][number]
  >;
}) {
  return input.decision.details.verificationArtifactIds.flatMap((artifactId) => {
    const artifact = input.artifactsById.get(artifactId);
    if (artifact?.kind !== "verification") {
      throw new KnowledgeError(
        "candidate_evidence_invalid",
        "verification_evidence_missing",
        "The verification artifact referenced by the decision was not found.",
      );
    }
    if (!artifact.details.targetClaims.some((claim) => claim.claimId === input.claimId)) return [];
    const evidence = input.evidenceByVerificationId.get(artifact.details.verificationId);
    if (evidence === undefined) {
      throw new KnowledgeError(
        "candidate_evidence_invalid",
        "verification_evidence_missing",
        "The verification source linked to the accepted claim is missing.",
      );
    }
    return [{
      verificationArtifact: artifact as VerificationArtifact,
      value: {
        verificationArtifactId: artifact.deliberationArtifactId,
        verificationId: evidence.result.verificationId,
        resultArtifactId: evidence.resultArtifact.artifactId,
        resultHash: evidence.resultArtifact.contentHash,
        repositoryRevision: evidence.result.repositoryRevision,
      },
    }];
  });
}
