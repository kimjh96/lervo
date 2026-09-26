import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { operatingContractHash, operatingDecisionId } from "./operating-mandate-admission.js";

/** Proof that an owner attention decision never recorded its escalation before supersession. */
export function isOwnerAttentionAbsence(
  inspection: Record<string, unknown>,
  plan: OperatingActionPlanV1,
  sourceRevisionDigest: string,
): boolean {
  return (
    Object.keys(inspection).length === 12 &&
    inspection.schemaVersion === 1 &&
    inspection.kind === "work.owner_attention_absence" &&
    plan.effectContract === "work.owner_attention.v1" &&
    inspection.effectContract === plan.effectContract &&
    inspection.decisionId === operatingDecisionId(plan) &&
    inspection.planHash === operatingContractHash(plan) &&
    inspection.effectHash === plan.effectHash &&
    inspection.sourceRevisionDigest === sourceRevisionDigest &&
    /^sha256:[a-f0-9]{64}$/u.test(sourceRevisionDigest) &&
    typeof inspection.receiptEventId === "string" &&
    /^evt_[a-f0-9]{32}$/u.test(inspection.receiptEventId) &&
    inspection.receiptAbsent === true &&
    typeof inspection.eventHeadHash === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(inspection.eventHeadHash) &&
    typeof inspection.observedAt === "string" &&
    Number.isFinite(Date.parse(inspection.observedAt)) &&
    ((inspection.invalidatedBy === "source_changed" &&
      sourceRevisionDigest !== plan.sourceRevisionDigest) ||
      (inspection.invalidatedBy === "deadline_expired" &&
        Date.parse(plan.deadline) <= Date.parse(inspection.observedAt)))
  );
}
