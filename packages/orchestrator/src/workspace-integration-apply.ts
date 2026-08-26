import {
  acquireWorkspaceIntegrationTargetLease,
  assertAssignmentExecutionAuthority,
  listAssignments,
  readWorkspace,
  readWorkspaceIntegrationAttempt,
  updateWorkspaceIntegrationAttempt,
  type WorkspaceIntegrationAttempt,
} from "@lervo/agent-workforce";
import {
  WorkspaceHostError,
  type WorkspaceIntegrationApplyResult,
  type WorkspaceIntegrationHostAdapter,
} from "@lervo/workspace-host";

import {
  isWorkspaceIntegrationPlan,
  type WorkspaceIntegrationPlan,
} from "./workspace-integration-contract.js";
import {
  assertIntegrationSourceBindings,
  finalizeIntegrationConflictSources,
  startIntegrationSources,
} from "./workspace-integration-source-state.js";

export interface WorkspaceIntegrationCandidateReceipt extends WorkspaceIntegrationApplyResult {
  attemptId: string;
  targetLeaseId: string;
}

function targetRequest(plan: WorkspaceIntegrationPlan) {
  return {
    repositoryRoot: plan.repositoryRoot,
    integrationWorkspacePath: plan.integrationWorkspacePath,
    integrationBaseCommit: plan.integrationBaseCommit,
    integrationMarker: plan.integrationMarker,
    targetRef: plan.targetRef,
    targetBeforeCommit: plan.targetBeforeCommit,
  };
}

function receipt(attempt: WorkspaceIntegrationAttempt): WorkspaceIntegrationCandidateReceipt {
  if (attempt.state === "leased")
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The integration attempt has no terminal candidate preparation result.",
    );
  return {
    attemptId: attempt.attemptId,
    targetLeaseId: attempt.targetLeaseId,
    status: attempt.state,
    targetBeforeCommit: attempt.targetBeforeCommit,
    candidateCommit: attempt.candidateCommit,
    candidateTreeHash: attempt.candidateTreeHash,
    conflictWorkspaceId: attempt.conflictWorkspaceId,
    conflictReason: attempt.conflictReason,
    operationAborted: attempt.state === "conflict",
    targetUnchanged: true,
  };
}

async function assertPlanBindings(input: {
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

async function acquireExactAttempt(plan: WorkspaceIntegrationPlan) {
  const existing = await readWorkspaceIntegrationAttempt(
    plan.repositoryRoot,
    plan.attempt.targetLeaseId,
  );
  if (existing !== null) {
    if (
      existing.attempt.attemptId !== plan.attempt.attemptId ||
      existing.attempt.planContentHash !== plan.contentHash
    )
      throw new WorkspaceHostError(
        "host_coordinate_invalid",
        "Another exact plan already owns this target generation.",
      );
    return existing;
  }
  return acquireWorkspaceIntegrationTargetLease({
    repositoryRoot: plan.repositoryRoot,
    attempt: plan.attempt,
    eventId: plan.leaseEventId,
  });
}

async function verifyRecordedResult(input: {
  plan: WorkspaceIntegrationPlan;
  attempt: WorkspaceIntegrationAttempt;
  integrationHost: WorkspaceIntegrationHostAdapter;
  occurredAt: string;
}): Promise<WorkspaceIntegrationCandidateReceipt> {
  const inspected = await input.integrationHost.inspectTarget(targetRequest(input.plan));
  const expectedHead =
    input.attempt.state === "candidate"
      ? input.attempt.candidateCommit
      : input.attempt.targetBeforeCommit;
  if (
    inspected.targetCommit !== input.attempt.targetBeforeCommit ||
    inspected.workspace.status !== "present" ||
    inspected.workspace.headCommit !== expectedHead ||
    !inspected.workspace.markerMatched ||
    !inspected.workspace.clean ||
    inspected.workspace.gitOperationInProgress !== false
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The recorded integration attempt no longer matches its isolated worktree.",
    );
  if (input.attempt.state === "conflict")
    await finalizeIntegrationConflictSources(input.plan, input.occurredAt);
  return receipt(input.attempt);
}

export async function applyWorkspaceIntegrationCandidate(input: {
  plan: WorkspaceIntegrationPlan;
  integrationHost: WorkspaceIntegrationHostAdapter;
  now?: Date;
}): Promise<WorkspaceIntegrationCandidateReceipt> {
  await assertPlanBindings(input);
  const occurredAt = (input.now ?? new Date()).toISOString();
  const existing = await readWorkspaceIntegrationAttempt(
    input.plan.repositoryRoot,
    input.plan.attempt.targetLeaseId,
  );
  if (
    existing !== null &&
    (existing.attempt.attemptId !== input.plan.attempt.attemptId ||
      existing.attempt.planContentHash !== input.plan.contentHash)
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "Another exact plan already owns this target generation.",
    );
  const inspected = await input.integrationHost.inspectTarget(targetRequest(input.plan));
  if (
    inspected.targetCommit !== input.plan.targetBeforeCommit ||
    inspected.workspace.status !== "present" ||
    !inspected.workspace.markerMatched ||
    !inspected.workspace.clean ||
    inspected.workspace.gitOperationInProgress !== false ||
    inspected.workspace.headCommit === null
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The integration target changed or is not safely recoverable.",
    );
  if (existing === null && inspected.workspace.headCommit !== input.plan.targetBeforeCommit)
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The integration target changed before its exclusive lease was acquired.",
    );
  let leased = await acquireExactAttempt(input.plan);
  if (leased.attempt.state !== "leased")
    return verifyRecordedResult({
      plan: input.plan,
      attempt: leased.attempt,
      integrationHost: input.integrationHost,
      occurredAt,
    });
  if (inspected.workspace.headCommit !== input.plan.targetBeforeCommit) {
    const reset = await input.integrationHost.resetCandidate({
      ...targetRequest(input.plan),
      candidateCommit: inspected.workspace.headCommit,
      idempotencyKey: input.plan.resetIdempotencyKey,
    });
    if (!reset)
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "A stranded integration candidate could not be reset exactly.",
      );
  }
  await startIntegrationSources(input.plan, occurredAt);
  const result = await input.integrationHost.applyIntegration({
    ...targetRequest(input.plan),
    attemptId: input.plan.attempt.attemptId,
    idempotencyKey: input.plan.idempotencyKey,
    sources: input.plan.sources.map((source) => ({
      workspaceId: source.workspaceId,
      generation: source.generation,
      headCommit: source.headCommit,
      commitIds: source.commitIds,
      strategy: source.strategy,
    })),
    commitTime: input.plan.createdAt,
  });
  if (!result.targetUnchanged || result.targetBeforeCommit !== input.plan.targetBeforeCommit)
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The integration adapter did not preserve the target ref.",
    );
  leased = await updateWorkspaceIntegrationAttempt({
    repositoryRoot: input.plan.repositoryRoot,
    targetLeaseId: input.plan.attempt.targetLeaseId,
    expectedContentHash: leased.contentHash,
    expectedRevision: leased.attempt.revision,
    eventId:
      result.status === "candidate"
        ? input.plan.candidateEventId
        : input.plan.conflictAttemptEventId,
    nextState: result.status,
    occurredAt,
    ...(result.candidateCommit === null
      ? {}
      : {
          candidateCommit: result.candidateCommit,
          candidateTreeHash: result.candidateTreeHash!,
        }),
    ...(result.conflictWorkspaceId === null
      ? {}
      : {
          conflictWorkspaceId: result.conflictWorkspaceId,
          conflictReason: result.conflictReason!,
        }),
  });
  if (leased.attempt.state === "conflict")
    await finalizeIntegrationConflictSources(input.plan, occurredAt);
  return receipt(leased.attempt);
}
