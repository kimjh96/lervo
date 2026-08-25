import { validateSchema, type EventEnvelope, type KnowledgeCandidate } from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

import {
  calculateKnowledgeCandidateId,
  knowledgeCandidateBytes,
  knowledgeSha256,
} from "./integrity.js";
import { KnowledgeError, type KnowledgeCandidateArtifact } from "./types.js";

export async function verifyKnowledgeCandidateOriginal(input: {
  candidate: KnowledgeCandidate;
  candidateArtifact: KnowledgeCandidateArtifact;
  events: EventStore;
  artifactStore: ArtifactStore;
}): Promise<EventEnvelope> {
  if (
    !validateSchema("knowledgeCandidate", input.candidate).valid ||
    calculateKnowledgeCandidateId(input.candidate) !== input.candidate.candidateId
  ) {
    throw new KnowledgeError(
      "candidate_contract_invalid",
      "candidate_schema_invalid",
      "The knowledge candidate schema or deterministic ID is invalid.",
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await input.artifactStore.get(input.candidateArtifact.uri);
  } catch (error) {
    throw new KnowledgeError(
      "candidate_evidence_invalid",
      "candidate_artifact_mismatch",
      "Could not read the knowledge candidate CAS source.",
      { cause: error },
    );
  }
  if (
    input.candidateArtifact.artifactId !== `art_${input.candidateArtifact.contentHash.slice(7)}` ||
    input.candidateArtifact.uri !==
      `lervo-cas://sha256/${input.candidateArtifact.contentHash.slice(7)}` ||
    input.candidateArtifact.contentHash !== knowledgeSha256(bytes) ||
    input.candidateArtifact.byteCount !== bytes.byteLength ||
    !Buffer.from(knowledgeCandidateBytes(input.candidate)).equals(Buffer.from(bytes))
  ) {
    throw new KnowledgeError(
      "candidate_evidence_invalid",
      "candidate_artifact_mismatch",
      "The knowledge candidate object and CAS source coordinates differ.",
    );
  }
  const matches = input.events
    .list()
    .filter(
      (event) =>
        event.type === "knowledge.candidate.created" &&
        event.payload.candidateId === input.candidate.candidateId &&
        event.payload.candidateArtifactId === input.candidateArtifact.artifactId &&
        event.payload.candidateContentHash === input.candidateArtifact.contentHash,
    );
  if (matches.length !== 1) {
    throw new KnowledgeError(
      "candidate_evidence_invalid",
      "candidate_event_missing",
      "Exactly one knowledge candidate creation event cannot be verified.",
    );
  }
  const event = matches[0]!;
  if (
    event.payload.claimDigest !== input.candidate.claim.claimDigest ||
    event.payload.sourceOutcomeId !== input.candidate.source.outcomeId ||
    event.payload.decisionArtifactId !== input.candidate.source.decisionArtifactId ||
    event.payload.verifiedRevision !== input.candidate.verifiedRevision ||
    JSON.stringify(event.payload.paths) !== JSON.stringify(input.candidate.paths) ||
    JSON.stringify(event.payload.evidenceIds) !== JSON.stringify(input.candidate.evidence.eventIds)
  ) {
    throw new KnowledgeError(
      "candidate_evidence_invalid",
      "candidate_event_missing",
      "The knowledge candidate creation event and CAS source coordinates differ.",
    );
  }
  if (input.candidate.evidence.eventIds.some((eventId) => input.events.get(eventId) === null)) {
    throw new KnowledgeError(
      "candidate_evidence_invalid",
      "evidence_event_missing",
      "The evidence event referenced by the knowledge candidate is missing from the current store.",
    );
  }
  try {
    const decisionBytes = await input.artifactStore.get(input.candidate.source.decisionContent.uri);
    if (
      knowledgeSha256(decisionBytes) !== input.candidate.source.decisionContent.contentHash ||
      decisionBytes.byteLength !== input.candidate.source.decisionContent.byteCount
    )
      throw new Error("decision mismatch");
  } catch (error) {
    throw new KnowledgeError(
      "candidate_evidence_invalid",
      "decision_content_unavailable",
      "The decision CAS source referenced by the knowledge candidate cannot be verified.",
      { cause: error },
    );
  }
  return event;
}
