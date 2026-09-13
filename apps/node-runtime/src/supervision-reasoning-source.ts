import type { ManagedWorkCausalityInput } from "@lervo/orchestrator";
import { managedExecutionIdentity } from "@lervo/work-controller";
import { inspectOwnerReasoning } from "./supervision-reasoning-receipt.js";
import type {
  OperatingActionPlanV1,
  SupervisedOwnerReasoningV1,
} from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  operatingContractHash,
  operatingDecisionId,
  supervisedOwnerReasoningFields,
} from "@lervo/work-controller";
import { readOwnerReasoningHistory } from "./supervision-reasoning-history.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import {
  assertOwnerReasoningContext,
  type OwnerReasoningContext,
} from "./supervision-reasoning-context.js";

export async function readCanonicalOwnerReasoning(input: {
  storage: ProjectStorage;
  binding: NodeSupervisionBinding;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  plan: OperatingActionPlanV1;
  now(): string;
}) {
  const { plan, source, storage } = input;
  const effect = (await readSupervisionJsonArtifact(
    storage.artifacts,
    plan.effectHash,
  )) as SupervisedOwnerReasoningV1;
  const fields = supervisedOwnerReasoningFields(effect);
  const owner = source.agents.find((agent) => agent.agentId === input.binding.ownerAgentId);
  if (
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    ) ||
    owner?.status !== "active" ||
    owner.roleId !== effect.roleId ||
    owner.roleVersion !== effect.roleVersion ||
    owner.roleContractHash !== effect.roleContractHash ||
    (owner.provider !== "any" && owner.provider !== effect.provider) ||
    plan.ownerAgentId !== owner.agentId ||
    !["active", "completed"].includes(source.workstream.status)
  )
    throw new Error("The owner reasoning effect differs from its active role and exact scope.");
  const context = (await readSupervisionJsonArtifact(
    storage.artifacts,
    effect.contextArtifactHash,
  )) as OwnerReasoningContext;
  await assertOwnerReasoningContext({ ...input, context, basisHash: effect.basisHash });
  if (
    source.workstream.status === "completed" &&
    (context.trigger.nextAction !== "publish_result" || context.facts.acceptedGoal === null)
  )
    throw new Error("Completed work permits only an exact accepted-result publication judgement.");
  const history = await readOwnerReasoningHistory({
    ...input,
    basisHash: effect.basisHash,
    excludeDecisionId: operatingDecisionId(plan),
  });
  if (
    effect.attemptNumber !== history.length + 1 ||
    effect.attemptNumber > context.facts.mandate.maximumAttemptsPerAssignment
  )
    throw new Error("The owner reasoning attempt is outside its canonical retry bound.");
  const role = context.facts.roles.find((role) => role.roleId === effect.roleId);
  if (
    role?.contractHash !== effect.roleContractHash ||
    role.version !== effect.roleVersion ||
    role.profile.capabilities["filesystem.read"] !== "allow" ||
    role.profile.outputContract.presentation.audience !== "machine" ||
    role.profile.defaultSkills.length > 0 ||
    role.profile.contextPolicy.requiredDocumentRuleIds.some(
      (rule) => rule !== "repository.instructions",
    )
  )
    throw new Error(
      "The owner reasoning role has unresolved context, skill or presentation requirements.",
    );
  let workCausality: ManagedWorkCausalityInput = {
    relationship: "root",
    workstreamId: plan.workstreamId,
    assignmentId: null,
    agentId: plan.ownerAgentId,
  };
  const previous = history.at(-1);
  if (previous !== undefined) {
    if ((await inspectOwnerReasoning(storage, previous.plan)).status !== "confirmed")
      throw new Error("The preceding owner invocation has no reconciled termination.");
    const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(previous.plan));
    const cause = source.events.find(
      (event) => event.type === "work.causality.recorded" && event.runId === identity.runId,
    );
    if (cause === undefined || cause.payload.attemptOrdinal !== effect.attemptNumber - 1)
      throw new Error("The preceding owner invocation has inconsistent retry ancestry.");
    workCausality = {
      ...workCausality,
      relationship: "retry",
      workId: String(cause.payload.workId),
      parentRunId: identity.runId,
      retryOfRunId: identity.runId,
      attemptOrdinal: effect.attemptNumber,
    };
  }
  return { effect, fields, context, role: role.profile, workCausality };
}
