import { createHash, randomBytes } from "node:crypto";

import {
  assertAssignmentExecutionAuthority,
  listAssignments,
  listWorkspaceIntegrationQueue,
  listWorkspaces,
  readWorkspace,
  type AgentWorkspace,
  type WorkforceProvider,
  type WorkspaceIntegrationAttempt,
} from "@lervo/agent-workforce";
import { repositoryCoordinateDigest } from "@lervo/project-storage";
import type { VerificationSuite } from "@lervo/schemas";
import { validateVerificationSuite, verificationSuiteHash } from "@lervo/verification-contract";
import {
  WorkspaceHostError,
  type WorkspaceIntegrationHostAdapter,
  type WorkspaceIntegrationStrategy,
  type WorkspaceOwnershipMarker,
} from "@lervo/workspace-host";

import {
  stableWorkspaceIntegrationJson,
  type WorkspaceIntegrationCollision,
  type WorkspaceIntegrationPlan,
  type WorkspaceIntegrationPlanSource,
  workspaceIntegrationDigest,
  workspaceIntegrationPlanContent,
} from "./workspace-integration-contract.js";

function randomId(prefix: "evt" | "idk" | "int" | "ipl"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function derivedId(prefix: "itl", material: unknown): string {
  return `${prefix}_${createHash("sha256")
    .update(workspaceIntegrationDigest(material))
    .digest("hex")
    .slice(0, 24)}`;
}

function markerFor(workspace: AgentWorkspace): WorkspaceOwnershipMarker {
  return {
    schemaVersion: 1,
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
    repositoryInstanceId: workspace.repositoryInstanceId,
    adapterKind: workspace.host.kind,
    adapterVersion: workspace.host.version,
    creationPlanId: workspace.creationPlanId,
    pathDigest: workspace.pathDigest,
  };
}

export function workspaceIntegrationCollisionReport(
  workspaces: Array<{ workspaceId: string; changedPaths: string[] }>,
): {
  changedPathUnionDigest: string;
  changedPathUnionCount: number;
  collisions: WorkspaceIntegrationCollision[];
} {
  const owners = new Map<string, string[]>();
  for (const workspace of workspaces)
    for (const path of workspace.changedPaths)
      owners.set(path, [...(owners.get(path) ?? []), workspace.workspaceId].sort());
  const paths = [...owners.keys()].sort();
  return {
    changedPathUnionDigest: workspaceIntegrationDigest(paths),
    changedPathUnionCount: paths.length,
    collisions: paths
      .filter((path) => owners.get(path)!.length > 1)
      .map((path) => ({
        pathDigest: workspaceIntegrationDigest(path),
        workspaceIds: owners.get(path)!,
      })),
  };
}

export async function planWorkspaceIntegrationCandidate(input: {
  repositoryRoot: string;
  integrationWorkspacePath: string;
  integrationWorkspaceId: string;
  integratorAgentId: string;
  integratorWriterSessionId: string;
  leaseId: string;
  provider: Exclude<WorkforceProvider, "any">;
  targetRef: string;
  targetGeneration: number;
  verificationSuites: readonly VerificationSuite[];
  selectedWorkspaceIds?: string[];
  strategies?: Partial<Record<string, WorkspaceIntegrationStrategy>>;
  integrationHost: WorkspaceIntegrationHostAdapter;
  now?: Date;
}): Promise<WorkspaceIntegrationPlan> {
  if (
    !Number.isSafeInteger(input.targetGeneration) ||
    input.targetGeneration < 1 ||
    input.integrationHost.capabilities.exactIntegration !== true ||
    input.integrationHost.capabilities.conflictAbort !== true
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The integration candidate host or target generation is invalid.",
    );
  const [storedIntegrator, assignments, workspaces] = await Promise.all([
    readWorkspace(input.repositoryRoot, input.integrationWorkspaceId),
    listAssignments(input.repositoryRoot),
    listWorkspaces(input.repositoryRoot),
  ]);
  const assignment = assignments.find(
    (item) => item.assignmentId === storedIntegrator?.workspace.assignmentId,
  );
  for (const suite of input.verificationSuites) validateVerificationSuite(suite);
  const verificationSuiteIds = input.verificationSuites.map((suite) => suite.suiteId);
  const targetDigest = repositoryCoordinateDigest(input.targetRef);
  if (
    storedIntegrator === null ||
    assignment === undefined ||
    assignment.taskType !== "repository.integration" ||
    assignment.lease === null ||
    assignment.lease.leaseId !== input.leaseId ||
    storedIntegrator.workspace.state !== "active" ||
    storedIntegrator.workspace.executionKind !== "integrator" ||
    storedIntegrator.workspace.agentId !== input.integratorAgentId ||
    storedIntegrator.workspace.writerSession?.sessionId !== input.integratorWriterSessionId ||
    storedIntegrator.workspace.pathDigest !==
      repositoryCoordinateDigest(input.integrationWorkspacePath) ||
    storedIntegrator.workspace.integrationTargetDigest !== targetDigest ||
    storedIntegrator.workspace.host.kind !== input.integrationHost.kind ||
    storedIntegrator.workspace.host.version !== input.integrationHost.version ||
    stableWorkspaceIntegrationJson(verificationSuiteIds) !==
      stableWorkspaceIntegrationJson(assignment.verificationSuiteIds)
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The integration workspace coordinate is stale or unauthorized.",
    );
  await assertAssignmentExecutionAuthority({
    repositoryRoot: input.repositoryRoot,
    assignmentId: assignment.assignmentId,
    agentId: input.integratorAgentId,
    leaseId: input.leaseId,
    provider: input.provider,
    expectedPaths: assignment.expectedPaths,
    verificationSuiteIds: assignment.verificationSuiteIds,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  const marker = markerFor(storedIntegrator.workspace);
  if (workspaceIntegrationDigest(marker) !== storedIntegrator.workspace.markerHash)
    throw new WorkspaceHostError(
      "host_marker_mismatch",
      "The integration workspace marker binding changed.",
    );
  const provisionalTarget = {
    repositoryRoot: input.repositoryRoot,
    integrationWorkspacePath: input.integrationWorkspacePath,
    integrationBaseCommit: storedIntegrator.workspace.baseCommit,
    integrationMarker: marker,
    targetRef: input.targetRef,
    targetBeforeCommit: storedIntegrator.workspace.baseCommit,
  };
  const targetInspection = await input.integrationHost.inspectTarget(provisionalTarget);
  const targetBeforeCommit = targetInspection.targetCommit;
  if (
    targetBeforeCommit === null ||
    targetInspection.workspace.status !== "present" ||
    targetInspection.workspace.headCommit !== targetBeforeCommit ||
    !targetInspection.workspace.markerMatched ||
    !targetInspection.workspace.clean ||
    targetInspection.workspace.gitOperationInProgress !== false
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The integration target is not an exact clean starting point.",
    );
  const queue = await listWorkspaceIntegrationQueue({
    repositoryRoot: input.repositoryRoot,
    completedAssignmentIds: assignments
      .filter((item) => item.status === "completed")
      .map((item) => item.assignmentId),
  });
  const selectedIds = input.selectedWorkspaceIds ?? queue.map((entry) => entry.workspaceId);
  if (
    selectedIds.length === 0 ||
    selectedIds.length > 32 ||
    new Set(selectedIds).size !== selectedIds.length
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The integration plan must select one bounded unique source set.",
    );
  const selected = selectedIds.map((workspaceId) => {
    const queueEntry = queue.find((entry) => entry.workspaceId === workspaceId);
    const workspace = workspaces.find((item) => item.workspaceId === workspaceId);
    if (
      queueEntry === undefined ||
      workspace === undefined ||
      workspace.state !== "integration_pending" ||
      workspace.generation !== queueEntry.generation ||
      workspace.integrationQueueEntryId !== queueEntry.queueEntryId ||
      workspace.sealedResult === null ||
      workspace.sealedResult.headCommit !== queueEntry.headCommit ||
      workspace.sealedResult.treeHash !== queueEntry.treeHash ||
      workspace.sealedResult.changedPathSetDigest !== queueEntry.changedPathSetDigest
    )
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "A selected integration source is stale or no longer sealed.",
      );
    return { queueEntry, workspace };
  });
  const selectedById = new Map(selected.map((item) => [item.workspace.workspaceId, item]));
  const ordered = queue
    .filter((entry) => selectedById.has(entry.workspaceId))
    .map((entry) => selectedById.get(entry.workspaceId)!);
  if (ordered.length !== selectedIds.length)
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The selected integration order could not be reproduced.",
    );
  const sources: WorkspaceIntegrationPlanSource[] = ordered.map(({ queueEntry, workspace }) => ({
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
    workspaceRevision: workspace.revision,
    workspaceContentHash: "",
    queueEntryId: queueEntry.queueEntryId,
    assignmentId: workspace.assignmentId,
    headCommit: workspace.sealedResult!.headCommit,
    treeHash: workspace.sealedResult!.treeHash,
    commitIds: [...workspace.sealedResult!.commitIds],
    changedPathSetDigest: workspace.sealedResult!.changedPathSetDigest,
    strategy: input.strategies?.[workspace.workspaceId] ?? "cherry_pick",
    integratingEventId: randomId("evt"),
    integratedEventId: randomId("evt"),
    conflictEventId: randomId("evt"),
    recoveryEventId: randomId("evt"),
  }));
  for (const source of sources) {
    const stored = await readWorkspace(input.repositoryRoot, source.workspaceId);
    if (
      stored === null ||
      stored.workspace.revision !== source.workspaceRevision ||
      stored.workspace.state !== "integration_pending"
    )
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "An integration source changed while the plan was being prepared.",
      );
    source.workspaceContentHash = stored.contentHash;
  }
  const report = workspaceIntegrationCollisionReport(
    ordered.map((item) => ({
      workspaceId: item.workspace.workspaceId,
      changedPaths: item.workspace.sealedResult!.changedPaths,
    })),
  );
  const createdAt = (input.now ?? new Date()).toISOString();
  const attemptId = randomId("int");
  const targetLeaseId = derivedId("itl", {
    repositoryInstanceId: storedIntegrator.workspace.repositoryInstanceId,
    targetDigest,
    targetGeneration: input.targetGeneration,
  });
  const attemptWithoutPlanHash: Omit<WorkspaceIntegrationAttempt, "planContentHash"> = {
    schemaVersion: 1,
    attemptId,
    targetLeaseId,
    repositoryInstanceId: storedIntegrator.workspace.repositoryInstanceId,
    targetDigest,
    targetGeneration: input.targetGeneration,
    targetBeforeCommit,
    integrationAssignmentId: assignment.assignmentId,
    integratorAgentId: input.integratorAgentId,
    integratorWorkspaceId: storedIntegrator.workspace.workspaceId,
    integratorWorkspaceGeneration: storedIntegrator.workspace.generation,
    sources: sources.map((source) => ({
      workspaceId: source.workspaceId,
      generation: source.generation,
      headCommit: source.headCommit,
      treeHash: source.treeHash,
      strategy: source.strategy,
    })),
    state: "leased",
    candidateCommit: null,
    candidateTreeHash: null,
    verificationReceiptHash: null,
    verificationResults: [],
    targetAfterCommit: null,
    conflictWorkspaceId: null,
    conflictReason: null,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  };
  const content = {
    schemaVersion: 1 as const,
    planKind: "workspace_integration_candidate" as const,
    planId: randomId("ipl"),
    createdAt,
    repositoryRoot: input.repositoryRoot,
    integrationWorkspacePath: input.integrationWorkspacePath,
    integrationWorkspaceId: storedIntegrator.workspace.workspaceId,
    integrationWorkspaceGeneration: storedIntegrator.workspace.generation,
    integrationWorkspaceRevision: storedIntegrator.workspace.revision,
    integrationWorkspaceContentHash: storedIntegrator.contentHash,
    integrationAssignmentId: assignment.assignmentId,
    integrationAssignmentRevision: assignment.revision,
    integratorAgentId: input.integratorAgentId,
    integratorWriterSessionId: input.integratorWriterSessionId,
    leaseId: input.leaseId,
    leaseGeneration: assignment.lease.generation,
    provider: input.provider,
    integrationBaseCommit: storedIntegrator.workspace.baseCommit,
    integrationMarker: marker,
    targetRef: input.targetRef,
    targetDigest,
    targetGeneration: input.targetGeneration,
    targetBeforeCommit,
    targetInspection,
    sources,
    ...report,
    verificationRequirements: input.verificationSuites.map((suite) => ({
      suiteId: suite.suiteId,
      suiteHash: verificationSuiteHash(suite),
    })),
    attempt: attemptWithoutPlanHash,
    leaseEventId: randomId("evt"),
    candidateEventId: randomId("evt"),
    conflictAttemptEventId: randomId("evt"),
    advancingEventId: randomId("evt"),
    integratedAttemptEventId: randomId("evt"),
    rollbackEventId: randomId("evt"),
    idempotencyKey: randomId("idk"),
    advanceIdempotencyKey: randomId("idk"),
    resetIdempotencyKey: randomId("idk"),
  };
  const contentHash = workspaceIntegrationPlanContent(content);
  return {
    ...content,
    attempt: { ...attemptWithoutPlanHash, planContentHash: contentHash },
    contentHash,
  };
}
