import type {
  SupervisionDecisionReceipt,
  WorkerReadinessObservationV1,
  WorkResponsibilityV1,
} from "@lervo/application-contract";
import type { EventStore } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";
import type { SupervisionEventJournal } from "./supervision-event-journal.js";

export interface SupervisionReadinessFailureRecord {
  responsibility: WorkResponsibilityV1;
  observation: WorkerReadinessObservationV1;
  reasonCodes: string[];
}

const FAILED_CODE = /^readiness_[a-z_]+_failed$/u;
const READINESS_FAILED = "work.supervision.readiness.failed";

/** Common supervision payload fields copied from the exact recorded decision event. */
export function supervisionPayloadFromDecision(
  decision: ReturnType<EventStore["list"]>[number],
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projectId: decision.payload.projectId,
    workstreamId: decision.payload.workstreamId,
    workstreamRevision: decision.payload.workstreamRevision,
    supervisionId: decision.payload.supervisionId,
    ownerAgentId: decision.payload.ownerAgentId,
    mandateHash: decision.payload.mandateHash,
    causationEventIds: [decision.eventId],
  };
}

/**
 * Records observed worker readiness failure for a recorded, unexecuted decision. Identity binds the
 * decision and the failed checks only, so a repeated identical failure appends nothing. Unobserved
 * checks never qualify; the record proves a safe non-start, not later repair or resumed execution.
 */
export async function recordSupervisionReadinessFailure(input: {
  journal: SupervisionEventJournal;
  events: EventStore;
  findDecision(decisionId: string): SupervisionDecisionReceipt | null;
  receipt: SupervisionDecisionReceipt;
  failure: SupervisionReadinessFailureRecord;
}): Promise<string> {
  const receipt = structuredClone(input.receipt);
  const { responsibility, observation } = structuredClone(input.failure);
  const current = input.findDecision(receipt.decisionId);
  const reasonCodes = [...new Set(input.failure.reasonCodes)].sort();
  if (
    current === null ||
    current.planHash !== receipt.planHash ||
    current.status !== "recorded" ||
    receipt.status !== "recorded" ||
    reasonCodes.length === 0 ||
    reasonCodes.length > 16 ||
    !reasonCodes.some((code) => FAILED_CODE.test(code)) ||
    reasonCodes.some((code) => !/^[a-z][a-z0-9_]{0,63}$/u.test(code)) ||
    observation.responsibilityArtifactHash !== operatingContractHash(responsibility) ||
    observation.agentId !== responsibility.executorAgentId ||
    observation.checks.every((check) => check.status !== "failed")
  )
    throw new Error("The readiness failure is not bound to a recorded, unexecuted decision.");
  const decision = input.events.get(
    input.journal.eventId("work.supervision.decision.recorded", receipt.decisionId),
  )!;
  const evidence = {
    schemaVersion: 1 as const,
    kind: "work.readiness_failure" as const,
    decisionId: receipt.decisionId,
    planHash: receipt.planHash,
    reasonCodes,
    sourceRevisionDigest: observation.sourceRevisionDigest,
    responsibilityArtifactHash: observation.responsibilityArtifactHash,
    agentId: observation.agentId,
    roleId: observation.roleId,
    roleVersion: observation.roleVersion,
    roleContractHash: observation.roleContractHash,
    failedChecks: observation.checks.filter((check) => check.status === "failed"),
  };
  const readinessEvidenceHash = await input.journal.put(evidence);
  const payload = {
    ...supervisionPayloadFromDecision(decision),
    decisionId: receipt.decisionId,
    planHash: receipt.planHash,
    assignmentId: responsibility.assignmentId,
    executorAgentId: responsibility.executorAgentId,
    responsibilityArtifactHash: observation.responsibilityArtifactHash,
    sourceRevisionDigest: observation.sourceRevisionDigest,
    readinessEvidenceHash,
    reasonCode: reasonCodes.find((code) => FAILED_CODE.test(code))!,
  };
  const identity = operatingContractHash({ decisionId: receipt.decisionId, readinessEvidenceHash });
  input.journal.append(READINESS_FAILED, payload, identity, () => {
    const latest = input.findDecision(receipt.decisionId);
    if (latest === null || latest.status !== "recorded")
      throw new Error("The decision changed before its readiness failure was recorded.");
  });
  return input.journal.eventId(READINESS_FAILED, identity);
}

/** Canonical readiness failures for one decision, in journal order; none proves later repair. */
export function findSupervisionReadinessFailures(
  journal: SupervisionEventJournal,
  decisionId: string,
): {
  eventId: string;
  readinessEvidenceHash: string;
  reasonCode: string;
  executorAgentId: string;
}[] {
  const failures = [];
  for (const event of journal.history()) {
    if (event.type !== READINESS_FAILED || event.payload.decisionId !== decisionId) continue;
    journal.assertEventBinding(event);
    failures.push({
      eventId: event.eventId,
      readinessEvidenceHash: String(event.payload.readinessEvidenceHash),
      reasonCode: String(event.payload.reasonCode),
      executorAgentId: String(event.payload.executorAgentId),
    });
  }
  return failures;
}
