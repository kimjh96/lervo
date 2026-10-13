import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { operatingContractHash, operatingDecisionId } from "./operating-mandate-admission.js";

/**
 * A superseded preparation proves absence, never successful host work or released task authority.
 * Version 3 proves no record was created. Version 9 proves a record was created but its host
 * effect never happened: no ready event, Git registration, or path, and the record was withdrawn.
 */
export function isWorkspacePreparationAbsence(
  inspection: Record<string, unknown>,
  plan: OperatingActionPlanV1,
  sourceRevisionDigest: string,
  expected: { workspaceId: unknown; provisionPlanHash: unknown },
): boolean {
  return (
    Object.keys(inspection).length === 16 &&
    (inspection.schemaVersion === 3
      ? inspection.workspaceRecordAbsent === true && inspection.coordinationEventsAbsent === true
      : inspection.schemaVersion === 9 &&
        inspection.workspaceRecordWithdrawn === true &&
        inspection.readyEventAbsent === true) &&
    inspection.kind === "work.effect_absence" &&
    plan.effectContract === "work.workspace_preparation.v1" &&
    inspection.effectContract === plan.effectContract &&
    inspection.decisionId === operatingDecisionId(plan) &&
    inspection.planHash === operatingContractHash(plan) &&
    inspection.effectHash === plan.effectHash &&
    inspection.sourceRevisionDigest === sourceRevisionDigest &&
    /^sha256:[a-f0-9]{64}$/u.test(sourceRevisionDigest) &&
    sourceRevisionDigest !== plan.sourceRevisionDigest &&
    typeof inspection.workspaceId === "string" &&
    /^wsp_[a-f0-9]{24}$/u.test(inspection.workspaceId) &&
    inspection.workspaceId === expected.workspaceId &&
    typeof inspection.provisionPlanHash === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(inspection.provisionPlanHash) &&
    inspection.provisionPlanHash === expected.provisionPlanHash &&
    inspection.hostRegistrationAbsent === true &&
    inspection.workspacePathAbsent === true &&
    typeof inspection.eventHeadHash === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(inspection.eventHeadHash) &&
    typeof inspection.observedAt === "string" &&
    Number.isFinite(Date.parse(inspection.observedAt)) &&
    (inspection.invalidatedBy === "source_changed" ||
      (inspection.invalidatedBy === "deadline_expired" &&
        Date.parse(plan.deadline) <= Date.parse(inspection.observedAt)))
  );
}
