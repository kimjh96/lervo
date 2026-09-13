import { createHash, randomBytes } from "node:crypto";

import {
  assertAssignmentExecutionAuthority,
  createWorkspace,
  listAssignments,
  readWorkspace,
  updateWorkspace,
  type AgentWorkspace,
  type WorkforceProvider,
} from "@lervo/agent-workforce";
import {
  repositoryCoordinateDigest,
  resolveRepositoryCoordinationHome,
} from "@lervo/project-storage";
import {
  WorkspaceHostError,
  type WorkspaceHostAdapter,
  type WorkspaceOwnershipMarker,
} from "@lervo/workspace-host";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function id(prefix: "evt" | "idk" | "wpl" | "wsp"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export interface WorkspaceProvisionPlan {
  schemaVersion: 1;
  planKind: "workspace_provision";
  planId: string;
  createdAt: string;
  repositoryRoot: string;
  workspacePath: string;
  assignmentId: string;
  assignmentRevision: number;
  agentId: string;
  leaseId: string;
  leaseGeneration: number;
  provider: Exclude<WorkforceProvider, "any">;
  baseCommit: string;
  workspace: AgentWorkspace;
  marker: WorkspaceOwnershipMarker;
  provisionEventId: string;
  readyEventId: string;
  recoveryEventId: string;
  idempotencyKey: string;
  contentHash: string;
}

function planContent(plan: Omit<WorkspaceProvisionPlan, "contentHash">): string {
  return digest(plan);
}

function validPlan(plan: WorkspaceProvisionPlan): boolean {
  const { contentHash, ...content } = plan;
  return (
    plan.schemaVersion === 1 &&
    plan.planKind === "workspace_provision" &&
    /^wpl_[a-f0-9]{24}$/u.test(plan.planId) &&
    COMMIT.test(plan.baseCommit) &&
    HASH.test(plan.marker.pathDigest) &&
    HASH.test(contentHash) &&
    planContent(content) === contentHash
  );
}

export async function planWorkspaceProvision(input: {
  repositoryRoot: string;
  workspacePath: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  provider: Exclude<WorkforceProvider, "any">;
  baseCommit: string;
  integrationTargetDigest: string;
  executionKind: "worker" | "integrator";
  workspaceId?: string;
  host: WorkspaceHostAdapter;
  now?: Date;
}): Promise<WorkspaceProvisionPlan> {
  if (!COMMIT.test(input.baseCommit) || !HASH.test(input.integrationTargetDigest))
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The workspace base or integration target coordinate is invalid.",
    );
  const assignment = (await listAssignments(input.repositoryRoot)).find(
    (item) => item.assignmentId === input.assignmentId,
  );
  if (assignment === undefined || assignment.lease === null)
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The workspace assignment lease does not exist.",
    );
  await assertAssignmentExecutionAuthority({
    repositoryRoot: input.repositoryRoot,
    assignmentId: input.assignmentId,
    agentId: input.agentId,
    leaseId: input.leaseId,
    provider: input.provider,
    expectedPaths: assignment.expectedPaths,
    verificationSuiteIds: assignment.verificationSuiteIds,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  const now = input.now ?? new Date();
  const home = await resolveRepositoryCoordinationHome(input.repositoryRoot, { now });
  const workspaceId = input.workspaceId ?? id("wsp");
  if (!/^wsp_[a-f0-9]{24}$/u.test(workspaceId))
    throw new WorkspaceHostError("host_coordinate_invalid", "The workspace identity is invalid.");
  const planId = id("wpl");
  const pathDigest = repositoryCoordinateDigest(input.workspacePath);
  const marker: WorkspaceOwnershipMarker = {
    schemaVersion: 1,
    workspaceId,
    generation: 1,
    repositoryInstanceId: home.repositoryInstanceId,
    adapterKind: input.host.kind,
    adapterVersion: input.host.version,
    creationPlanId: planId,
    pathDigest,
  };
  const createdAt = now.toISOString();
  const workspace: AgentWorkspace = {
    schemaVersion: 1,
    workspaceId,
    generation: 1,
    repositoryInstanceId: home.repositoryInstanceId,
    projectId: assignment.projectId,
    assignmentId: assignment.assignmentId,
    agentId: input.agentId,
    leaseGeneration: assignment.lease.generation,
    executionKind: input.executionKind,
    host: { kind: input.host.kind, version: input.host.version, nativeInstanceDigest: null },
    baseCommit: input.baseCommit,
    integrationTargetDigest: input.integrationTargetDigest,
    creationPlanId: planId,
    markerHash: digest(marker),
    pathDigest,
    ownerWorkspacePath: input.workspacePath,
    state: "provisioning",
    writerSession: null,
    sealedResult: null,
    integrationQueueEntryId: null,
    integrationEvidenceId: null,
    cleanupPlanId: null,
    recoveryReason: null,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  };
  const content = {
    schemaVersion: 1 as const,
    planKind: "workspace_provision" as const,
    planId,
    createdAt,
    repositoryRoot: input.repositoryRoot,
    workspacePath: input.workspacePath,
    assignmentId: assignment.assignmentId,
    assignmentRevision: assignment.revision,
    agentId: input.agentId,
    leaseId: input.leaseId,
    leaseGeneration: assignment.lease.generation,
    provider: input.provider,
    baseCommit: input.baseCommit,
    workspace,
    marker,
    provisionEventId: id("evt"),
    readyEventId: id("evt"),
    recoveryEventId: id("evt"),
    idempotencyKey: id("idk"),
  };
  return { ...content, contentHash: planContent(content) };
}

export async function applyWorkspaceProvision(input: {
  plan: WorkspaceProvisionPlan;
  host: WorkspaceHostAdapter;
  now?: Date;
  revalidate?: () => Promise<void>;
  recordApplied?: (workspace: AgentWorkspace) => Promise<void>;
}): Promise<AgentWorkspace> {
  if (
    !validPlan(input.plan) ||
    input.host.kind !== input.plan.marker.adapterKind ||
    input.host.version !== input.plan.marker.adapterVersion
  )
    throw new WorkspaceHostError("host_coordinate_invalid", "The workspace plan is invalid.");
  const assignment = (await listAssignments(input.plan.repositoryRoot)).find(
    (item) => item.assignmentId === input.plan.assignmentId,
  );
  if (
    assignment === undefined ||
    assignment.revision !== input.plan.assignmentRevision ||
    assignment.lease?.generation !== input.plan.leaseGeneration
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The workspace plan assignment binding is stale.",
    );
  await assertAssignmentExecutionAuthority({
    repositoryRoot: input.plan.repositoryRoot,
    assignmentId: input.plan.assignmentId,
    agentId: input.plan.agentId,
    leaseId: input.plan.leaseId,
    provider: input.plan.provider,
    expectedPaths: assignment.expectedPaths,
    verificationSuiteIds: assignment.verificationSuiteIds,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  await input.revalidate?.();
  let stored = await readWorkspace(input.plan.repositoryRoot, input.plan.workspace.workspaceId);
  if (stored === null) {
    await createWorkspace({
      repositoryRoot: input.plan.repositoryRoot,
      workspace: input.plan.workspace,
      eventId: input.plan.provisionEventId,
    });
    stored = await readWorkspace(input.plan.repositoryRoot, input.plan.workspace.workspaceId);
  }
  if (stored === null)
    throw new WorkspaceHostError("host_effect_uncertain", "Workspace state was not recorded.");
  if (stored.workspace.state === "ready") {
    await input.revalidate?.();
    await input.recordApplied?.(stored.workspace);
    return stored.workspace;
  }
  if (
    stored.workspace.state !== "provisioning" ||
    digest(stored.workspace) !== digest(input.plan.workspace)
  )
    throw new WorkspaceHostError("host_effect_uncertain", "Workspace state differs from the plan.");

  try {
    await input.revalidate?.();
    const inspection = await input.host.provision({
      repositoryRoot: input.plan.repositoryRoot,
      workspacePath: input.plan.workspacePath,
      baseCommit: input.plan.baseCommit,
      marker: input.plan.marker,
      idempotencyKey: input.plan.idempotencyKey,
    });
    if (
      inspection.status !== "present" ||
      inspection.headCommit !== input.plan.baseCommit ||
      !inspection.clean ||
      !inspection.markerMatched ||
      inspection.nativeInstanceDigest === null
    )
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "The host did not return exact ready evidence.",
      );
    await input.revalidate?.();
    const ready = (
      await updateWorkspace({
        repositoryRoot: input.plan.repositoryRoot,
        workspaceId: input.plan.workspace.workspaceId,
        expectedContentHash: stored.contentHash,
        eventId: input.plan.readyEventId,
        expectedRevision: stored.workspace.revision,
        expectedGeneration: stored.workspace.generation,
        nextState: "ready",
        occurredAt: (input.now ?? new Date()).toISOString(),
        evidence: { hostInspected: true, markerMatched: true, checkoutClean: true },
        hostNativeInstanceDigest: inspection.nativeInstanceDigest,
      })
    ).workspace;
    await input.revalidate?.();
    await input.recordApplied?.(ready);
    return ready;
  } catch (error) {
    const latest = await readWorkspace(input.plan.repositoryRoot, input.plan.workspace.workspaceId);
    if (latest !== null && ["provisioning", "ready"].includes(latest.workspace.state))
      await updateWorkspace({
        repositoryRoot: input.plan.repositoryRoot,
        workspaceId: input.plan.workspace.workspaceId,
        expectedContentHash: latest.contentHash,
        eventId: input.plan.recoveryEventId,
        expectedRevision: latest.workspace.revision,
        expectedGeneration: latest.workspace.generation,
        nextState: "recovery_required",
        occurredAt: (input.now ?? new Date()).toISOString(),
        recoveryReason: "host_effect_uncertain",
        reasonCode: "host_effect_uncertain",
      });
    throw error;
  }
}
