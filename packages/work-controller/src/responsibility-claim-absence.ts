import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { operatingContractHash, operatingDecisionId } from "./operating-mandate-admission.js";

/** Successor responsibility revisions whose never-written effect a version-7 inspection proves. */
const RESPONSIBILITY_REVISION_CONTRACTS = [
  "work.responsibility_claim.v1",
  "work.assignment_amendment.v1",
];

/**
 * A superseded responsibility claim or assignment amendment proves that its exact decision wrote
 * no binding or amendment; it never proves lease release, worker start, or later claim authority.
 * The revision expires at the earlier of its plan deadline and its responsibility start deadline,
 * after which it cannot take effect.
 */
export function isResponsibilityClaimAbsence(
  inspection: Record<string, unknown>,
  plan: OperatingActionPlanV1,
  sourceRevisionDigest: string,
  startDeadline: string,
): boolean {
  return (
    Object.keys(inspection).length === 13 &&
    inspection.schemaVersion === 7 &&
    inspection.kind === "work.effect_absence" &&
    RESPONSIBILITY_REVISION_CONTRACTS.includes(plan.effectContract) &&
    inspection.effectContract === plan.effectContract &&
    inspection.decisionId === operatingDecisionId(plan) &&
    inspection.planHash === operatingContractHash(plan) &&
    inspection.effectHash === plan.effectHash &&
    inspection.sourceRevisionDigest === sourceRevisionDigest &&
    /^sha256:[a-f0-9]{64}$/u.test(sourceRevisionDigest) &&
    typeof inspection.assignmentId === "string" &&
    /^asn_[a-f0-9]{24}$/u.test(inspection.assignmentId) &&
    typeof inspection.assignmentSourceHash === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(inspection.assignmentSourceHash) &&
    inspection.bindingEventAbsent === true &&
    typeof inspection.eventHeadHash === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(inspection.eventHeadHash) &&
    typeof inspection.observedAt === "string" &&
    Number.isFinite(Date.parse(inspection.observedAt)) &&
    ((inspection.invalidatedBy === "source_changed" &&
      sourceRevisionDigest !== plan.sourceRevisionDigest) ||
      (inspection.invalidatedBy === "deadline_expired" &&
        Math.min(Date.parse(plan.deadline), Date.parse(startDeadline)) <=
          Date.parse(inspection.observedAt)))
  );
}
