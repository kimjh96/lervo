import type {
  OperatingMandate,
  SupervisedAssignmentObservationV1,
} from "@lervo/application-contract";
import type { EventEnvelope, WorkstreamSnapshot } from "@lervo/schemas";
import { operatingContractHash } from "@lervo/work-controller";

function mandateScope(mandate: OperatingMandate) {
  const { version, issuedAt, expiresAt, ...scope } = mandate;
  return scope;
}

function workstreamPurpose(workstream: WorkstreamSnapshot) {
  return {
    schemaVersion: workstream.schemaVersion,
    workstreamId: workstream.workstreamId,
    status: workstream.status,
    title: workstream.title,
    objective: workstream.objective,
    origin: workstream.origin,
  };
}

/** Carries only an exhausted-retry decision across administrative renewal, never task activity. */
export function retainsExhaustedRecoveryAttention(input: {
  reasonCode: string;
  decisionId: string;
  previousMandate: OperatingMandate;
  currentMandate: OperatingMandate;
  previousWorkstream: WorkstreamSnapshot;
  currentWorkstream: WorkstreamSnapshot;
  interveningEvents: EventEnvelope[];
  assignments: Pick<
    SupervisedAssignmentObservationV1,
    "status" | "effectDisposition" | "recoveryDecisionCount"
  >[];
}) {
  if (input.reasonCode !== "retry_budget_requires_resolution") return false;
  if (
    operatingContractHash(mandateScope(input.previousMandate)) !==
      operatingContractHash(mandateScope(input.currentMandate)) ||
    operatingContractHash(workstreamPurpose(input.previousWorkstream)) !==
      operatingContractHash(workstreamPurpose(input.currentWorkstream))
  )
    return false;
  if (
    input.interveningEvents.some(
      (event) =>
        !(
          (event.type === "work.supervision.effect.observed" &&
            event.payload.decisionId === input.decisionId &&
            event.payload.status === "effect_confirmed") ||
          event.type === "workstream.snapshot.recorded" ||
          event.type === "work.supervision.mandate.installed"
        ),
    )
  )
    return false;
  const maximumRecoveryDecisions = Math.min(
    3,
    input.currentMandate.maximumAttemptsPerAssignment - 1,
  );
  return input.assignments.some(
    (assignment) =>
      assignment.status === "failed" &&
      assignment.effectDisposition === "known_safe_failure" &&
      assignment.recoveryDecisionCount >= maximumRecoveryDecisions,
  );
}
