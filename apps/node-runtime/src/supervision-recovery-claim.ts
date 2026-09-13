import { readAssignmentAmendmentEffect } from "./supervision-assignment-amendment-source.js";
import { inspectAssignmentAmendmentReceipt } from "./supervision-assignment-amendment-receipt.js";
import type {
  OperatingActionPlanV1,
  SupervisedResponsibilityClaimV1,
} from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  managedExecutionIdentity,
  operatingContractHash,
  supervisedResponsibilityClaimFields,
} from "@lervo/work-controller";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { readAssignmentRecoveryEffect } from "./supervision-assignment-recovery-source.js";
import { inspectAssignmentRecoveryReceipt } from "./supervision-assignment-recovery-receipt.js";

export async function materializeSuccessorClaim(input: {
  storage: ProjectStorage;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  base: OperatingActionPlanV1;
  assignmentIds: string[];
  now(): string;
}): Promise<OperatingActionPlanV1 | null> {
  const assignment = input.source.assignments.find(
    (item) =>
      input.assignmentIds.includes(item.assignmentId) &&
      item.status === "queued" &&
      (item.recovery !== undefined || item.amendment !== undefined),
  );
  if (assignment === undefined) return null;
  const amendment = assignment.recovery === undefined;
  const reopened = input.source.events.findLast(
    (event) =>
      event.type === (amendment ? "assignment.amended" : "assignment.reopened") &&
      event.payload.assignmentId === assignment.assignmentId &&
      event.payload.assignmentRevision === assignment.revision,
  );
  const decision = input.source.events.find(
    (event) =>
      event.type === "work.supervision.decision.recorded" &&
      managedExecutionIdentity(input.base.projectId, String(event.payload.planHash)).runId ===
        reopened?.runId,
  );
  if (decision === undefined)
    throw new Error("The changed assignment has no admitted transition decision.");
  const plan = (await readSupervisionJsonArtifact(
    input.storage.artifacts,
    String(decision.payload.planArtifactHash),
  )) as OperatingActionPlanV1;
  if (
    (
      await (amendment ? inspectAssignmentAmendmentReceipt : inspectAssignmentRecoveryReceipt)(
        input.storage,
        plan,
      )
    ).status !== "confirmed"
  )
    throw new Error("The exact assignment transition receipt is unavailable.");
  const basis = await (amendment ? readAssignmentAmendmentEffect : readAssignmentRecoveryEffect)(
    input.storage,
    plan,
  );
  const rationale = await input.storage.artifacts.put(
    canonicalJson(
      `Acquire successor duties from admitted assignment transition ${operatingContractHash(plan)}. Earlier artifacts remain preserved.`,
    ),
  );
  const effect: SupervisedResponsibilityClaimV1 = {
    schemaVersion: 1,
    kind: "work.responsibility_claim",
    responsibility: basis.effect.responsibility,
    expectedAssignmentHash: operatingContractHash(assignment),
    provider: basis.effect.provider,
    leaseDurationMs: supervisionClaimDuration(basis.effect.responsibility, input.now()),
    rationaleArtifactHash: rationale.contentHash,
  };
  await input.storage.artifacts.put(canonicalJson(effect));
  return { ...input.base, ...supervisedResponsibilityClaimFields(effect) };
}
import { supervisionClaimDuration } from "./supervision-claim-duration.js";
