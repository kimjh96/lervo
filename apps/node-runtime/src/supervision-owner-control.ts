import type {
  OperatingActionPlanV1,
  SupervisedArtifactReviewV1,
  SupervisedGoalCompletionV1,
  SupervisedResultDelivery,
} from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import {
  assertSupervisedArtifactReview,
  assertSupervisedReviewBasis,
  operatingContractHash,
  supervisedArtifactReviewFields,
  assertSupervisedGoalCompletion,
  supervisedGoalCompletionFields,
  assertSupervisedResultDelivery,
  supervisedResultDeliveryFields,
} from "@lervo/work-controller";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { observeSupervisionTasks } from "./supervision-task-observation.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { assertCanonicalGoalCompletionBasis } from "./supervision-goal-completion-basis.js";
import { readCanonicalResultDelivery } from "./supervision-result-delivery-basis.js";
import { readCanonicalSupervisionHandoff } from "./supervision-handoff-source.js";
import { readSupervisionHandoffState } from "./supervision-handoff-state.js";

/** Exact owner review scope and canonical result basis; no fabricated worker readiness. */
export async function readSupervisionOwnerControl(input: {
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  binding: NodeSupervisionBinding;
  events: EventStore;
  artifacts: ArtifactStore;
  plan: OperatingActionPlanV1;
}) {
  const { source, binding, events, artifacts, plan } = input;
  if (["work.scoped_handoff.v1", "work.scoped_handoff_acceptance.v1"].includes(plan.effectContract))
    return readCanonicalSupervisionHandoff(input);
  const effect = (await readSupervisionJsonArtifact(artifacts, plan.effectHash)) as
    SupervisedArtifactReviewV1 | SupervisedGoalCompletionV1 | SupervisedResultDelivery;
  let fields;
  if (effect.kind === "work.result_delivery") {
    assertSupervisedResultDelivery(effect, plan);
    fields = supervisedResultDeliveryFields(effect);
  } else if (effect.kind === "work.goal_completion") {
    assertSupervisedGoalCompletion(effect, plan);
    fields = supervisedGoalCompletionFields(effect);
  } else {
    assertSupervisedArtifactReview(effect, plan);
    fields = supervisedArtifactReviewFields(effect);
  }
  const owner = source.agents.find((item) => item.agentId === plan.ownerAgentId);
  if (
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    ) ||
    owner?.status !== "active" ||
    owner.roleId !== plan.roleId ||
    (owner.provider !== "any" && owner.provider !== plan.provider) ||
    plan.ownerAgentId !== binding.ownerAgentId ||
    source.workstream.workstreamId !== plan.workstreamId
  )
    throw new Error("The owner control scope differs from its exact effect or active owner.");
  const observed = await observeSupervisionTasks(source, artifacts, binding, events);
  if (effect.kind === "work.result_delivery") {
    await readCanonicalResultDelivery({ source, observed, effect, artifacts, events });
  } else if (effect.kind === "work.goal_completion") {
    const handoffs = await readSupervisionHandoffState(
      { events, artifacts, projectId: plan.projectId },
      source,
      binding,
      effect.completedAt,
    );
    if (handoffs.pendingIncoming.length > 0 || handoffs.pendingOutgoing.length > 0)
      throw new Error("Goal completion requires resolution of its pending scoped handoffs.");
    await assertCanonicalGoalCompletionBasis({ source, observed, effect, artifacts });
  } else {
    const assignment = observed.assignments.find(
      (item) => item.assignmentId === effect.assignmentId,
    );
    if (assignment === undefined) throw new Error("The owner control responsibility is unbound.");
    assertSupervisedReviewBasis(effect, assignment);
  }
  const rationale = await readSupervisionJsonArtifact(artifacts, effect.rationaleArtifactHash);
  if (typeof rationale !== "string" || rationale.trim().length === 0)
    throw new Error("The owner control rationale is unavailable.");
  return { effect, fields };
}
