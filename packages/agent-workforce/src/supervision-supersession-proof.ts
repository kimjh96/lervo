import type {
  OperatingActionPlanV1,
  SupervisionDecisionReceipt,
  SupervisedResponsibilityClaimV1,
  SupervisedWorkspacePreparationV1,
} from "@lervo/application-contract";
import { collectRunEventsBounded, type EventStore } from "@lervo/storage-contract";
import {
  isManagedExecutionAbsence,
  managedExecutionAbsenceEventsMatch,
  managedExecutionIdentity,
  operatingContractHash,
  isOwnerReasoningAbsence,
  ownerControlSupersession,
  isResultDeliveryAbsence,
  isResponsibilityClaimAbsence,
  isWorkspacePreparationAbsence,
  supervisedResponsibilityClaimFields,
  supervisedWorkspacePreparationFields,
} from "@lervo/work-controller";

import type { SupervisionEventJournal } from "./supervision-event-journal.js";

/**
 * A superseded decision is settled only when its recorded inspection still proves that the
 * decision's effect never took place. Absence checks read current state, so this runs on every use.
 */
export async function assertSupersededDecisionProof(input: {
  journal: SupervisionEventJournal;
  events: EventStore;
  receipt: SupervisionDecisionReceipt;
  readPlan(): Promise<OperatingActionPlanV1>;
}): Promise<void> {
  const { journal, events, receipt, readPlan } = input;
  const supersession = events.get(
    journal.eventId("work.supervision.decision.superseded", receipt.decisionId),
  );
  if (supersession === null) throw new Error("The superseded decision has no inspection record.");
  const inspection = (await journal.read(
    String(supersession.payload.inspectionArtifactHash),
  )) as Record<string, unknown>;
  const plan = await readPlan();
  // An owner control proves only that its receipt, such as an escalation, never took effect.
  const control = ownerControlSupersession(
    inspection,
    plan,
    supersession.payload,
    (id) => events.get(id) !== null,
  );
  if (control !== null) {
    if (!control || operatingContractHash(plan) !== receipt.planHash)
      throw new Error("The superseded decision inspection is inconsistent.");
    return;
  }
  if (
    inspection.kind !== "work.effect_absence" ||
    inspection.decisionId !== receipt.decisionId ||
    inspection.planHash !== receipt.planHash ||
    operatingContractHash(plan) !== receipt.planHash ||
    inspection.effectHash !== plan.effectHash ||
    inspection.sourceRevisionDigest !== supersession.payload.sourceRevisionDigest ||
    !(inspection.schemaVersion === 1
      ? plan.effectContract === "assignment.topology.materialize.v1" &&
        inspection.assignmentAbsent === true &&
        inspection.creationEventAbsent === true
      : inspection.schemaVersion === 4 || inspection.schemaVersion === 5
        ? isManagedExecutionAbsence(
            inspection,
            plan,
            String(supersession.payload.sourceRevisionDigest),
          ) &&
          managedExecutionAbsenceEventsMatch(
            inspection,
            plan,
            collectRunEventsBounded({
              events: events,
              runId: managedExecutionIdentity(plan.projectId, operatingContractHash(plan)).runId,
              maximumEvents: 4096,
            }),
          )
        : inspection.schemaVersion === 7
          ? isResponsibilityClaimAbsence(
              inspection,
              plan,
              String(supersession.payload.sourceRevisionDigest),
              await claimStartDeadline(journal, plan),
            )
          : inspection.schemaVersion === 8
            ? isResultDeliveryAbsence(
                inspection,
                plan,
                String(supersession.payload.sourceRevisionDigest),
              ) && events.get(String(inspection.queueEventId)) === null
            : inspection.schemaVersion === 3
              ? await validWorkspaceAbsence(
                  journal,
                  inspection,
                  plan,
                  String(supersession.payload.sourceRevisionDigest),
                )
              : isOwnerReasoningAbsence(
                  inspection,
                  plan,
                  String(supersession.payload.sourceRevisionDigest),
                ) &&
                collectRunEventsBounded({
                  events: events,
                  runId: managedExecutionIdentity(plan.projectId, operatingContractHash(plan))
                    .runId,
                  maximumEvents: 4096,
                }).length === 0)
  )
    throw new Error("The superseded decision inspection is inconsistent.");
}

async function validWorkspaceAbsence(
  journal: SupervisionEventJournal,
  inspection: Record<string, unknown>,
  plan: OperatingActionPlanV1,
  sourceRevisionDigest: string,
): Promise<boolean> {
  if (plan.effectContract !== "work.workspace_preparation.v1") return false;
  const effect = (await journal.read(plan.effectHash)) as SupervisedWorkspacePreparationV1;
  const fields = supervisedWorkspacePreparationFields(effect);
  if (
    fields.effectHash !== plan.effectHash ||
    fields.responsibilityArtifactHash !== plan.responsibilityArtifactHash
  )
    return false;
  const provision = (await journal.read(effect.provisionPlanHash)) as {
    workspace?: { workspaceId?: unknown };
  };
  return isWorkspacePreparationAbsence(inspection, plan, sourceRevisionDigest, {
    workspaceId: provision?.workspace?.workspaceId,
    provisionPlanHash: effect.provisionPlanHash,
  });
}

/** The exact claim effect's start deadline; its absence may be proven once that window closes. */
async function claimStartDeadline(
  journal: SupervisionEventJournal,
  plan: OperatingActionPlanV1,
): Promise<string> {
  const effect = (await journal.read(plan.effectHash)) as SupervisedResponsibilityClaimV1;
  if (supervisedResponsibilityClaimFields(effect).effectHash !== plan.effectHash)
    throw new Error("The superseded claim effect differs from its plan.");
  return effect.responsibility.startDeadline;
}
