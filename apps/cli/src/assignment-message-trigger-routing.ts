import {
  assignmentMessageTriggerProvenance,
  createAssignmentMessageTriggerPlan,
  type AssignmentMessageTriggerAdapterV1,
  type AssignmentMessageTriggerRequestV1,
  type AssignmentMessageTriggerResultV1,
} from "@lervo/agent-workforce";

import {
  inspectAssignmentMentionRoute,
  routeAssignmentMention,
  type RouteAssignmentMentionInput,
} from "./assignment-mention-routing.js";

function mentionInput(input: {
  repositoryRoot: string;
  request: AssignmentMessageTriggerRequestV1;
}): RouteAssignmentMentionInput {
  return {
    repositoryRoot: input.repositoryRoot,
    assignmentId: input.request.assignmentId,
    fromAgentId: input.request.source.fromAgentId,
    leaseId: input.request.leaseId,
    target: { kind: "agent", agentId: input.request.source.toAgentId },
    requestDigest: input.request.source.content.contentHash,
    artifactReferences: [structuredClone(input.request.source.content)],
    contextEvidenceEventIds: [...input.request.contextEvidenceEventIds],
  };
}

async function currentPlan(input: {
  repositoryRoot: string;
  request: AssignmentMessageTriggerRequestV1;
  adapter: AssignmentMessageTriggerAdapterV1;
}) {
  const observedAt = new Date().toISOString();
  const boundary = await input.adapter.inspect({
    adapterId: input.request.adapterId,
    source: input.request.source,
  });
  const mention = await inspectAssignmentMentionRoute(
    mentionInput({ repositoryRoot: input.repositoryRoot, request: input.request }),
  );
  return createAssignmentMessageTriggerPlan({
    request: input.request,
    descriptor: boundary.descriptor,
    observation: boundary.observation,
    routePlan: mention.plan,
    existingHandoffs: mention.assignment.handoffs,
    observedAt,
  });
}

export async function routeAssignmentMessageTrigger(input: {
  repositoryRoot: string;
  request: AssignmentMessageTriggerRequestV1;
  adapter: AssignmentMessageTriggerAdapterV1;
  applyPlanId?: string;
}): Promise<AssignmentMessageTriggerResultV1> {
  const plan = await currentPlan(input);
  if (input.applyPlanId === undefined) {
    return { plan, handoffId: plan.existingHandoffId };
  }
  if (plan.planId !== input.applyPlanId) {
    throw new Error("The assignment message trigger plan is stale.");
  }
  if (plan.status === "blocked") {
    throw new Error(
      `The assignment message trigger is blocked: ${plan.blockedReasons.join(", ")}.`,
    );
  }
  if (plan.status === "current") {
    return { plan, handoffId: plan.existingHandoffId };
  }
  const routed = await routeAssignmentMention({
    ...mentionInput({ repositoryRoot: input.repositoryRoot, request: input.request }),
    applyPlanId: plan.routePlanId,
    trigger: assignmentMessageTriggerProvenance(plan),
  });
  return { plan, handoffId: routed.appliedHandoffId };
}
