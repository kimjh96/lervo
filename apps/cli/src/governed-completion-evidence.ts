import type { ProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";
import { completionEvidenceId } from "@lervo/work-controller";
import { validateWorkCausalityHistory } from "@lervo/execution-contract";
import { validateSchema, type RunCompletedEventPayload } from "@lervo/schemas";
import { collectEventsOfTypesBounded } from "@lervo/storage-contract";

/** Causal records and run completions are the only history this evidence check consumes. */
const completionSourceEventTypes = ["work.causality.recorded", "run.completed"] as const;
/** Bounds the matching events retained, never the length of project history. */
const maximumSourceEvents = 100_000;

export function recordGovernedCompletionEvidence(input: {
  storage: ProjectStorage;
  workstreamId: string;
  assignmentId: string;
  assignmentRevision: number;
  agentId: string;
  leaseId: string;
  runId: string;
  sessionId: string;
  resultArtifactId: string;
  resultContentHash: string;
  preparedAt: string;
}): string {
  const events = collectEventsOfTypesBounded({
    events: input.storage.events,
    types: completionSourceEventTypes,
    maximumEvents: maximumSourceEvents,
  });
  const causal = validateWorkCausalityHistory(events).get(input.runId);
  const completed = events.filter(
    (event) => event.runId === input.runId && event.type === "run.completed",
  );
  const runPayload = completed[0]?.payload;
  if (
    causal === undefined ||
    causal.payload.workstreamId !== input.workstreamId ||
    causal.payload.assignmentId !== input.assignmentId ||
    causal.payload.agentId !== input.agentId ||
    completed.length !== 1 ||
    completed[0]!.sessionId !== input.sessionId ||
    !validateSchema("runCompletedEventPayload", runPayload).valid ||
    (runPayload as RunCompletedEventPayload).verificationStatus !== "passed" ||
    (runPayload as RunCompletedEventPayload).resultDigest !== input.resultContentHash ||
    !(runPayload as RunCompletedEventPayload).artifactIds.includes(input.resultArtifactId)
  ) {
    throw new Error("The governed completion evidence differs from canonical managed-run history.");
  }
  const coordinate = {
    workstreamId: input.workstreamId,
    assignmentId: input.assignmentId,
    assignmentRevision: input.assignmentRevision,
    agentId: input.agentId,
    leaseId: input.leaseId,
    runId: input.runId,
    sessionId: input.sessionId,
    resultArtifactId: input.resultArtifactId,
    resultContentHash: input.resultContentHash,
    preparedAt: input.preparedAt,
  };
  const evidenceId = completionEvidenceId(coordinate);
  const eventId = `evt_${evidenceId.slice("acp_".length)}`;
  const payload = {
    completionEvidenceId: evidenceId,
    workstreamId: input.workstreamId,
    assignmentId: input.assignmentId,
    assignmentRevision: input.assignmentRevision,
    agentId: input.agentId,
    leaseId: input.leaseId,
    resultArtifactId: input.resultArtifactId,
    resultContentHash: input.resultContentHash,
    verificationStatus: "passed",
    writingPublicationStatus: "allowed",
    preparedAt: input.preparedAt,
  } as const;
  const existing = input.storage.events.get(eventId);
  if (existing !== null) {
    if (
      existing.type !== "assignment.completion.prepared" ||
      existing.runId !== input.runId ||
      existing.sessionId !== input.sessionId ||
      JSON.stringify(existing.payload) !== JSON.stringify(payload)
    ) {
      throw new Error("The completion evidence ID already binds different coordinates.");
    }
    return evidenceId;
  }
  input.storage.events.append({
    eventId,
    projectId: input.storage.manifest.projectId,
    runId: input.runId,
    sessionId: input.sessionId,
    type: "assignment.completion.prepared",
    occurredAt: input.preparedAt,
    actor: { kind: "system" },
    schemaVersion: 2,
    policyVersion: sha256(JSON.stringify(payload)),
    payload,
  });
  return evidenceId;
}
