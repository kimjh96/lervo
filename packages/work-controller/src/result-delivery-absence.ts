import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { operatingContractHash, operatingDecisionId } from "./operating-mandate-admission.js";

/** A result-delivery supersession proves that its immutable outbound never entered the queue. */
export function isResultDeliveryAbsence(
  inspection: Record<string, unknown>,
  plan: OperatingActionPlanV1,
  sourceRevisionDigest: string,
): boolean {
  return (
    Object.keys(inspection).length === 12 &&
    inspection.schemaVersion === 8 &&
    inspection.kind === "work.effect_absence" &&
    ["work.result_delivery.v1", "work.result_delivery.v2"].includes(plan.effectContract) &&
    inspection.effectContract === plan.effectContract &&
    inspection.decisionId === operatingDecisionId(plan) &&
    inspection.planHash === operatingContractHash(plan) &&
    inspection.effectHash === plan.effectHash &&
    inspection.sourceRevisionDigest === sourceRevisionDigest &&
    /^sha256:[a-f0-9]{64}$/u.test(sourceRevisionDigest) &&
    typeof inspection.queueEventId === "string" &&
    /^evt_[a-f0-9]{32}$/u.test(inspection.queueEventId) &&
    inspection.queueEventAbsent === true &&
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
