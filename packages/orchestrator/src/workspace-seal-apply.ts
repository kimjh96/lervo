import {
  assertAssignmentExecutionAuthority,
  enqueueWorkspaceIntegration,
  listAssignments,
  readWorkspace,
  updateWorkspace,
  type AgentWorkspace,
} from "@lervo/agent-workforce";
import { WorkspaceHostError, type WorkspaceHostAdapter } from "@lervo/workspace-host";

import {
  isWorkspaceSealPlan,
  sameWorkspaceSealValue,
  type WorkspaceSealPlan,
} from "./workspace-seal-contract.js";

async function currentPlanBindings(input: {
  plan: WorkspaceSealPlan;
  host: WorkspaceHostAdapter;
  now?: Date;
}) {
  if (
    !isWorkspaceSealPlan(input.plan) ||
    input.host.kind !== input.plan.marker.adapterKind ||
    input.host.version !== input.plan.marker.adapterVersion
  )
    throw new WorkspaceHostError("host_coordinate_invalid", "The workspace seal plan is invalid.");
  const [stored, assignment, inspection] = await Promise.all([
    readWorkspace(input.plan.repositoryRoot, input.plan.workspaceId),
    listAssignments(input.plan.repositoryRoot).then((assignments) =>
      assignments.find((item) => item.assignmentId === input.plan.assignmentId),
    ),
    input.host.inspectResult({
      repositoryRoot: input.plan.repositoryRoot,
      workspacePath: input.plan.workspacePath,
      baseCommit: input.plan.sealedResult.baseCommit,
      marker: input.plan.marker,
    }),
  ]);
  if (
    stored === null ||
    assignment === undefined ||
    assignment.revision !== input.plan.assignmentRevision ||
    assignment.lease?.leaseId !== input.plan.leaseId ||
    assignment.lease.generation !== input.plan.leaseGeneration ||
    !sameWorkspaceSealValue(inspection, input.plan.inspection)
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The workspace seal plan binding changed before apply.",
    );
  await assertAssignmentExecutionAuthority({
    repositoryRoot: input.plan.repositoryRoot,
    assignmentId: input.plan.assignmentId,
    agentId: input.plan.agentId,
    leaseId: input.plan.leaseId,
    provider: input.plan.provider,
    expectedPaths: input.plan.expectedPaths,
    verificationSuiteIds: assignment.verificationSuiteIds,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  return stored;
}

export async function applyWorkspaceSeal(input: {
  plan: WorkspaceSealPlan;
  host: WorkspaceHostAdapter;
  now?: Date;
}): Promise<AgentWorkspace> {
  let stored = await currentPlanBindings(input);
  if (stored.workspace.state === "integration_pending") {
    if (
      stored.workspace.integrationQueueEntryId !== input.plan.queueEntry.queueEntryId ||
      !sameWorkspaceSealValue(stored.workspace.sealedResult, input.plan.sealedResult)
    )
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "The sealed workspace differs from the plan.",
      );
    return stored.workspace;
  }
  const occurredAt = (input.now ?? new Date()).toISOString();
  if (stored.workspace.state === "active") {
    if (
      stored.contentHash !== input.plan.workspaceContentHash ||
      stored.workspace.revision !== input.plan.workspaceRevision ||
      stored.workspace.generation !== input.plan.workspaceGeneration ||
      stored.workspace.writerSession?.sessionId !== input.plan.writerSessionId
    )
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "The active workspace differs from the plan.",
      );
    stored = await updateWorkspace({
      repositoryRoot: input.plan.repositoryRoot,
      workspaceId: input.plan.workspaceId,
      expectedContentHash: stored.contentHash,
      eventId: input.plan.sealingEventId,
      expectedRevision: stored.workspace.revision,
      expectedGeneration: stored.workspace.generation,
      nextState: "sealing",
      occurredAt,
      evidence: { writerFrozen: true },
      writerSession: null,
    });
  }
  if (stored.workspace.state === "sealing")
    stored = await updateWorkspace({
      repositoryRoot: input.plan.repositoryRoot,
      workspaceId: input.plan.workspaceId,
      expectedContentHash: stored.contentHash,
      eventId: input.plan.sealedEventId,
      expectedRevision: stored.workspace.revision,
      expectedGeneration: stored.workspace.generation,
      nextState: "sealed",
      occurredAt,
      evidence: { checkoutClean: true },
      sealedResult: input.plan.sealedResult,
    });
  if (
    stored.workspace.state !== "sealed" ||
    !sameWorkspaceSealValue(stored.workspace.sealedResult, input.plan.sealedResult)
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The workspace could not be sealed exactly.",
    );
  await enqueueWorkspaceIntegration({
    repositoryRoot: input.plan.repositoryRoot,
    entry: input.plan.queueEntry,
  });
  return (
    await updateWorkspace({
      repositoryRoot: input.plan.repositoryRoot,
      workspaceId: input.plan.workspaceId,
      expectedContentHash: stored.contentHash,
      eventId: input.plan.pendingEventId,
      expectedRevision: stored.workspace.revision,
      expectedGeneration: stored.workspace.generation,
      nextState: "integration_pending",
      occurredAt,
      evidence: { queueEntryCommitted: true },
      integrationQueueEntryId: input.plan.queueEntry.queueEntryId,
    })
  ).workspace;
}
