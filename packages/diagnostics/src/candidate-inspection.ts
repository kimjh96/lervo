import {
  calculateKnowledgeCandidateId,
  knowledgeCandidateBytes,
  knowledgeSha256,
} from "@lervo/knowledge";
import {
  validateSchema,
  type EventEnvelope,
  type KnowledgeCandidate,
  type KnowledgeCandidateCreatedEventPayload,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { DoctorIssue } from "./types.js";

function issue(
  issues: DoctorIssue[],
  code: DoctorIssue["code"],
  eventId: string,
  message: string,
): void {
  issues.push({ code, eventId, message });
}

function eventBy(input: {
  events: readonly EventEnvelope[];
  type: EventEnvelope["type"];
  evidenceIds: ReadonlySet<string>;
  matches(event: EventEnvelope): boolean;
}): boolean {
  return input.events.some((event) =>
    input.evidenceIds.has(event.eventId) && event.type === input.type && input.matches(event));
}

export async function inspectCandidate(input: {
  event: EventEnvelope;
  events: readonly EventEnvelope[];
  artifacts: ArtifactStore;
}): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  if (!validateSchema("knowledgeCandidateCreatedEventPayload", input.event.payload).valid) {
    issue(
      issues,
      "candidate_event_mismatch",
      input.event.eventId,
      "지식 후보 생성 event가 현재 payload 계약과 다릅니다.",
    );
    return issues;
  }
  const payload = input.event.payload as unknown as KnowledgeCandidateCreatedEventPayload;
  const uri = `lervo-cas://sha256/${payload.candidateContentHash.slice(7)}`;
  let candidate: KnowledgeCandidate;
  try {
    const bytes = await input.artifacts.get(uri);
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    if (!validateSchema("knowledgeCandidate", parsed).valid) throw new Error("schema invalid");
    candidate = parsed as KnowledgeCandidate;
    if (
      knowledgeSha256(bytes) !== payload.candidateContentHash ||
      payload.candidateArtifactId !== `art_${payload.candidateContentHash.slice(7)}` ||
      calculateKnowledgeCandidateId(candidate) !== candidate.candidateId ||
      !Buffer.from(knowledgeCandidateBytes(candidate)).equals(Buffer.from(bytes))
    ) throw new Error("coordinate mismatch");
  } catch {
    issue(
      issues,
      "candidate_artifact_invalid",
      input.event.eventId,
      "지식 후보 CAS 원본의 schema, hash 또는 ID를 확인할 수 없습니다.",
    );
    return issues;
  }
  if (
    candidate.candidateId !== payload.candidateId ||
    candidate.claim.claimDigest !== payload.claimDigest ||
    candidate.source.outcomeId !== payload.sourceOutcomeId ||
    candidate.source.decisionArtifactId !== payload.decisionArtifactId ||
    candidate.verifiedRevision !== payload.verifiedRevision ||
    JSON.stringify(candidate.paths) !== JSON.stringify(payload.paths)
  ) {
    issue(
      issues,
      "candidate_event_mismatch",
      input.event.eventId,
      "지식 후보 원본과 생성 event 좌표가 다릅니다.",
    );
  }
  const evidenceIds = new Set(payload.evidenceIds);
  if (payload.evidenceIds.some((eventId) => !input.events.some((event) =>
    event.eventId === eventId))) {
    issue(
      issues,
      "candidate_evidence_missing",
      input.event.eventId,
      "지식 후보가 참조한 evidence event가 없습니다.",
    );
  }
  if (!eventBy({
    events: input.events,
    type: "deliberation.completed",
    evidenceIds,
    matches: (event) =>
      event.payload.outcomeId === payload.sourceOutcomeId &&
      event.payload.status === "converged" &&
      event.payload.decisionArtifactId === payload.decisionArtifactId,
  })) {
    issue(
      issues,
      "candidate_outcome_not_converged",
      input.event.eventId,
      "지식 후보의 converged outcome event를 확인할 수 없습니다.",
    );
  }
  if (!eventBy({
    events: input.events,
    type: "deliberation.artifact.recorded",
    evidenceIds,
    matches: (event) =>
      event.payload.deliberationArtifactId === payload.decisionArtifactId &&
      event.payload.kind === "decision",
  })) {
    issue(
      issues,
      "candidate_decision_missing",
      input.event.eventId,
      "지식 후보의 decision artifact event를 확인할 수 없습니다.",
    );
  }
  if (payload.verificationArtifactIds.some((artifactId) => !eventBy({
    events: input.events,
    type: "deliberation.artifact.recorded",
    evidenceIds,
    matches: (event) =>
      event.payload.deliberationArtifactId === artifactId &&
      event.payload.kind === "verification",
  }))) {
    issue(
      issues,
      "candidate_verification_missing",
      input.event.eventId,
      "지식 후보의 verification artifact event를 확인할 수 없습니다.",
    );
  }
  try {
    const content = await input.artifacts.get(candidate.source.decisionContent.uri);
    if (
      knowledgeSha256(content) !== candidate.source.decisionContent.contentHash ||
      content.byteLength !== candidate.source.decisionContent.byteCount
    ) throw new Error("decision mismatch");
  } catch {
    issue(
      issues,
      "candidate_decision_missing",
      input.event.eventId,
      "지식 후보가 참조한 decision 원문을 CAS에서 확인할 수 없습니다.",
    );
  }
  return issues;
}
