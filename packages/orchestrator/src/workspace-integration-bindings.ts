import {
  assertAssignmentExecutionAuthority,
  listAssignments,
  readWorkspace,
} from "@lervo/agent-workforce";
import { WorkspaceHostError, type WorkspaceIntegrationHostAdapter } from "@lervo/workspace-host";

import {
  isWorkspaceIntegrationPlan,
  type WorkspaceIntegrationPlan,
} from "./workspace-integration-contract.js";
import { assertIntegrationSourceBindings } from "./workspace-integration-source-state.js";

export async function assertWorkspaceIntegrationPlanBindings(input: {
  plan: WorkspaceIntegrationPlan;
  integrationHost: WorkspaceIntegrationHostAdapter;
  now?: Date;
}): Promise<void> {
  const { plan } = input;
  if (
    !isWorkspaceIntegrationPlan(plan) ||
    input.integrationHost.kind !== plan.integrationMarker.adapterKind ||
    input.integrationHost.version !== plan.integrationMarker.adapterVersion ||
    input.integrationHost.capabilities.exactIntegration !== true ||
    input.integrationHost.capabilities.conflictAbort !== true
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The integration candidate plan or host is invalid.",
    );
  const [integrator, assignments] = await Promise.all([
    readWorkspace(plan.repositoryRoot, plan.integrationWorkspaceId),
    listAssignments(plan.repositoryRoot),
  ]);
  const assignment = assignments.find((item) => item.assignmentId === plan.integrationAssignmentId);
  if (
    integrator === null ||
    assignment === undefined ||
    assignment.taskType !== "repository.integration" ||
    assignment.revision !== plan.integrationAssignmentRevision ||
    assignment.lease?.leaseId !== plan.leaseId ||
    assignment.lease.generation !== plan.leaseGeneration ||
    integrator.contentHash !== plan.integrationWorkspaceContentHash ||
    integrator.workspace.state !== "active" ||
    integrator.workspace.revision !== plan.integrationWorkspaceRevision ||
    integrator.workspace.generation !== plan.integrationWorkspaceGeneration ||
    integrator.workspace.writerSession?.sessionId !== plan.integratorWriterSessionId
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The integration authority changed before apply.",
    );
  await assertAssignmentExecutionAuthority({
    repositoryRoot: plan.repositoryRoot,
    assignmentId: plan.integrationAssignmentId,
    agentId: plan.integratorAgentId,
    leaseId: plan.leaseId,
    provider: plan.provider,
    expectedPaths: assignment.expectedPaths,
    verificationSuiteIds: assignment.verificationSuiteIds,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  await assertIntegrationSourceBindings(plan);
}
