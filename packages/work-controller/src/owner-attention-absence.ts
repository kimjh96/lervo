import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { operatingContractHash, operatingDecisionId } from "./operating-mandate-admission.js";

/** Proof that an owner control, such as an escalation or artifact review, never took effect. */
export function isOwnerAttentionAbsence(
  inspection: Record<string, unknown>,
  plan: OperatingActionPlanV1,
  sourceRevisionDigest: string,
): boolean {
  return (
    Object.keys(inspection).length === 12 &&
    inspection.schemaVersion === 1 &&
    ((inspection.kind === "work.owner_attention_absence" &&
      plan.effectContract === "work.owner_attention.v1" &&
      typeof inspection.receiptEventId === "string" &&
      /^evt_[a-f0-9]{32}$/u.test(inspection.receiptEventId)) ||
      (inspection.kind === "work.owner_control_absence" &&
        ["work.artifact_review.v1", "work.goal_completion.v1"].includes(plan.effectContract) &&
        inspection.receiptEventId === null)) &&
    inspection.effectContract === plan.effectContract &&
    inspection.decisionId === operatingDecisionId(plan) &&
    inspection.planHash === operatingContractHash(plan) &&
    inspection.effectHash === plan.effectHash &&
    inspection.sourceRevisionDigest === sourceRevisionDigest &&
    /^sha256:[a-f0-9]{64}$/u.test(sourceRevisionDigest) &&
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

/**
 * Null when the supersession is not an owner-control absence; otherwise whether its proof is
 * valid and its receipt, when it names one, is still absent from the event store.
 */
export function ownerControlSupersession(
  inspection: Record<string, unknown>,
  plan: OperatingActionPlanV1,
  supersession: Record<string, unknown>,
  eventExists: (eventId: string) => boolean,
): boolean | null {
  if (
    !["work.owner_attention.v1", "work.artifact_review.v1", "work.goal_completion.v1"].includes(
      plan.effectContract,
    ) ||
    !["work.owner_attention_absence", "work.owner_control_absence"].includes(
      String(inspection.kind),
    )
  )
    return null;
  return (
    isOwnerAttentionAbsence(inspection, plan, String(supersession.sourceRevisionDigest)) &&
    (inspection.receiptEventId === null || !eventExists(String(inspection.receiptEventId)))
  );
}
