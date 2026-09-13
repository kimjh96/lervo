import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { managedExecutionIdentity } from "./managed-execution-identity.js";
import { operatingContractHash, operatingDecisionId } from "./operating-mandate-admission.js";

/** Recovery validates the same bounded inspection that the fenced recorder persisted. */
export function isOwnerReasoningAbsence(
  inspection: Record<string, unknown>,
  plan: OperatingActionPlanV1,
  sourceRevisionDigest: string,
): boolean {
  const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(plan));
  return (
    ((inspection.schemaVersion === 2 && Object.keys(inspection).length === 12) ||
      (inspection.schemaVersion === 6 &&
        Object.keys(inspection).length === 13 &&
        (inspection.invalidatedBy === "source_changed" ||
          (inspection.invalidatedBy === "deadline_expired" &&
            typeof inspection.observedAt === "string" &&
            Date.parse(plan.deadline) <= Date.parse(inspection.observedAt))))) &&
    inspection.kind === "work.effect_absence" &&
    plan.effectContract === "work.owner_reasoning.v1" &&
    inspection.effectContract === plan.effectContract &&
    inspection.decisionId === operatingDecisionId(plan) &&
    inspection.planHash === operatingContractHash(plan) &&
    inspection.effectHash === plan.effectHash &&
    inspection.sourceRevisionDigest === sourceRevisionDigest &&
    /^sha256:[a-f0-9]{64}$/u.test(sourceRevisionDigest) &&
    sourceRevisionDigest !== plan.sourceRevisionDigest &&
    inspection.runId === identity.runId &&
    inspection.sessionId === identity.sessionId &&
    inspection.runEventsAbsent === true &&
    typeof inspection.eventHeadHash === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(inspection.eventHeadHash) &&
    typeof inspection.observedAt === "string" &&
    Number.isFinite(Date.parse(inspection.observedAt))
  );
}
