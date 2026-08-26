import { createHash, randomBytes } from "node:crypto";

import {
  assertAssignmentExecutionAuthority,
  listAssignments,
  listWorkspaces,
  partitionWorkspaceChanges,
  readWorkspace,
  recordWorkspaceCheckpoint,
  updateWorkspace,
  type AgentWorkspace,
  type WorkspaceCheckpoint,
} from "@lervo/agent-workforce";
import { repositoryCoordinateDigest } from "@lervo/project-storage";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import type { WorkspaceHostInspection, WorkspaceOwnershipMarker } from "@lervo/workspace-host";

export interface TerminalWorkspaceBinding {
  executionKind: "worker" | "integrator";
  workspaceId: string;
  workspaceGeneration: number;
  workspaceRevision: number;
  assignmentId: string;
  leaseGeneration: number;
  writerSessionId: string;
}

export interface TerminalWorkspaceInspection {
  issues: Array<{ code: string; command: string }>;
  binding: TerminalWorkspaceBinding;
  workspace: AgentWorkspace | null;
  assignmentRevision: number | null;
  host: WorkspaceHostInspection | null;
  changedPathSetDigest: string | null;
  changedPathCount: number | null;
}

export class TerminalWorkspaceIsolationError extends Error {
  constructor(
    readonly code:
      | "assignment_scope_changed"
      | "shared_workspace_mutation"
      | "workspace_marker_mismatch"
      | "writer_lease_lost",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TerminalWorkspaceIsolationError";
  }
}

function isolationFailure(
  code: TerminalWorkspaceIsolationError["code"],
  message: string,
  cause?: unknown,
): never {
  throw new TerminalWorkspaceIsolationError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

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

function writerSessionId(provider: "codex" | "claude", providerSessionId: string): string {
  return `ses_terminal_${createHash("sha256")
    .update(`${provider}\0${providerSessionId}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function marker(workspace: AgentWorkspace): WorkspaceOwnershipMarker {
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

function hostFor(workspace: AgentWorkspace): GitWorkspaceHostAdapter {
  if (workspace.host.kind !== "git")
    throw new Error("The workspace host adapter is not available to direct terminal integration.");
  const host = new GitWorkspaceHostAdapter();
  if (host.version !== workspace.host.version)
    throw new Error("The workspace host adapter version changed before terminal attachment.");
  return host;
}

async function exactAssignment(input: {
  root: string;
  workspace: AgentWorkspace;
  provider: "codex" | "claude";
  now: Date;
}) {
  const assignment = (await listAssignments(input.root)).find(
    (item) => item.assignmentId === input.workspace.assignmentId,
  );
  if (
    assignment?.lease === null ||
    assignment === undefined ||
    assignment.lease.generation !== input.workspace.leaseGeneration
  )
    throw new Error("The workspace assignment lease is absent or belongs to another generation.");
  await assertAssignmentExecutionAuthority({
    repositoryRoot: input.root,
    assignmentId: assignment.assignmentId,
    agentId: input.workspace.agentId,
    leaseId: assignment.lease.leaseId,
    provider: input.provider,
    expectedPaths: assignment.expectedPaths,
    verificationSuiteIds: assignment.verificationSuiteIds,
    now: input.now,
  });
  return assignment;
}

export async function attachTerminalWorkspace(input: {
  root: string;
  provider: "codex" | "claude";
  providerSessionId: string;
  now?: Date;
}): Promise<TerminalWorkspaceBinding | null> {
  const pathDigest = repositoryCoordinateDigest(input.root);
  const matches = (await listWorkspaces(input.root)).filter(
    (workspace) => workspace.pathDigest === pathDigest && workspace.state !== "removed",
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1)
    isolationFailure(
      "shared_workspace_mutation",
      "Multiple active workspace generations claim this checkout.",
    );
  let workspace = matches[0]!;
  const expectedMarker = marker(workspace);
  if (digest(expectedMarker) !== workspace.markerHash)
    isolationFailure("workspace_marker_mismatch", "The workspace marker binding is invalid.");
  const now = input.now ?? new Date();
  try {
    await exactAssignment({ root: input.root, workspace, provider: input.provider, now });
  } catch (error) {
    isolationFailure(
      "assignment_scope_changed",
      "The workspace assignment lease is not current.",
      error,
    );
  }
  let inspected: WorkspaceHostInspection;
  try {
    inspected = await hostFor(workspace).inspect({
      repositoryRoot: input.root,
      workspacePath: input.root,
      baseCommit: workspace.baseCommit,
      marker: expectedMarker,
    });
  } catch (error) {
    isolationFailure("workspace_marker_mismatch", "The workspace host inspection failed.", error);
  }
  if (inspected.status !== "present" || !inspected.markerMatched)
    isolationFailure(
      "workspace_marker_mismatch",
      "The terminal checkout does not match its workspace marker.",
    );
  const sessionId = writerSessionId(input.provider, input.providerSessionId);
  if (workspace.state === "ready") {
    const stored = await readWorkspace(input.root, workspace.workspaceId);
    if (stored === null)
      isolationFailure(
        "workspace_marker_mismatch",
        "The workspace record disappeared before activation.",
      );
    workspace = (
      await updateWorkspace({
        repositoryRoot: input.root,
        workspaceId: workspace.workspaceId,
        expectedContentHash: stored.contentHash,
        eventId: `evt_${randomBytes(12).toString("hex")}`,
        expectedRevision: workspace.revision,
        expectedGeneration: workspace.generation,
        nextState: "active",
        occurredAt: now.toISOString(),
        writerSession: { sessionId, startedAt: now.toISOString() },
      })
    ).workspace;
  } else if (workspace.state !== "active" || workspace.writerSession?.sessionId !== sessionId) {
    isolationFailure(
      "writer_lease_lost",
      "The workspace is not writable by this terminal session.",
    );
  }
  return {
    executionKind: workspace.executionKind,
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.generation,
    workspaceRevision: workspace.revision,
    assignmentId: workspace.assignmentId,
    leaseGeneration: workspace.leaseGeneration,
    writerSessionId: sessionId,
  };
}

export async function inspectTerminalWorkspace(input: {
  root: string;
  provider: "codex" | "claude";
  providerSessionId: string;
  binding: TerminalWorkspaceBinding;
  now?: Date;
}): Promise<TerminalWorkspaceInspection> {
  const issues: TerminalWorkspaceInspection["issues"] = [];
  const stored = await readWorkspace(input.root, input.binding.workspaceId);
  if (stored === null) {
    issues.push({ code: "workspace_marker_mismatch", command: "lervo workspace inspect --json" });
    return {
      issues,
      binding: input.binding,
      workspace: null,
      assignmentRevision: null,
      host: null,
      changedPathSetDigest: null,
      changedPathCount: null,
    };
  }
  const workspace = stored.workspace;
  if (
    workspace.generation !== input.binding.workspaceGeneration ||
    workspace.revision !== input.binding.workspaceRevision ||
    workspace.assignmentId !== input.binding.assignmentId ||
    workspace.leaseGeneration !== input.binding.leaseGeneration
  )
    issues.push({ code: "workspace_revision_changed", command: "lervo workspace inspect --json" });
  const sessionId = writerSessionId(input.provider, input.providerSessionId);
  if (
    workspace.state !== "active" ||
    workspace.writerSession?.sessionId !== input.binding.writerSessionId ||
    sessionId !== input.binding.writerSessionId
  )
    issues.push({ code: "writer_lease_lost", command: "lervo workspace inspect --json" });
  let assignmentRevision: number | null = null;
  let expectedPaths: string[] = [];
  try {
    const assignment = await exactAssignment({
      root: input.root,
      workspace,
      provider: input.provider,
      now: input.now ?? new Date(),
    });
    assignmentRevision = assignment.revision;
    expectedPaths = assignment.expectedPaths;
  } catch {
    issues.push({ code: "assignment_scope_changed", command: "lervo assignment list --json" });
  }
  let host: WorkspaceHostInspection | null = null;
  let changedPathSetDigest: string | null = null;
  let changedPathCount: number | null = null;
  try {
    const expectedMarker = marker(workspace);
    if (digest(expectedMarker) !== workspace.markerHash)
      throw new Error("Workspace marker hash mismatch.");
    host = await hostFor(workspace).inspect({
      repositoryRoot: input.root,
      workspacePath: input.root,
      baseCommit: workspace.baseCommit,
      marker: expectedMarker,
    });
    if (host.status !== "present" || !host.markerMatched)
      issues.push({ code: "workspace_marker_mismatch", command: "lervo workspace inspect --json" });
    if (host.gitOperationInProgress)
      issues.push({
        code: "shared_workspace_mutation",
        command: "finish or abort the Git operation",
      });
    if (host.changedPaths === null) {
      issues.push({ code: "shared_workspace_mutation", command: "lervo workspace inspect --json" });
    } else {
      const partition = partitionWorkspaceChanges({
        expectedPaths,
        changedPaths: host.changedPaths,
        runtimeExcludedPaths: [".lervo/state", ".lervo/data"],
      });
      if (partition.outsideScope.length > 0)
        issues.push({ code: "workspace_path_escape", command: "lervo workspace inspect --json" });
      changedPathSetDigest = digest(partition.expected);
      changedPathCount = partition.expected.length;
    }
  } catch {
    issues.push({ code: "workspace_marker_mismatch", command: "lervo workspace inspect --json" });
  }
  return {
    issues,
    binding: input.binding,
    workspace,
    assignmentRevision,
    host,
    changedPathSetDigest,
    changedPathCount,
  };
}

export async function checkpointTerminalWorkspace(input: {
  root: string;
  inspection: TerminalWorkspaceInspection;
  contextEventId: string;
  occurredAt: string;
}): Promise<WorkspaceCheckpoint> {
  const { workspace, host, assignmentRevision, changedPathSetDigest, changedPathCount } =
    input.inspection;
  if (
    input.inspection.issues.length > 0 ||
    workspace === null ||
    host === null ||
    host.headCommit === null ||
    host.treeHash === null ||
    host.changedPaths === null ||
    assignmentRevision === null ||
    changedPathSetDigest === null ||
    changedPathCount === null
  )
    throw new Error("The worker workspace is not eligible for a checkpoint.");
  const eventId = `evt_${createHash("sha256")
    .update(`workspace-checkpoint\0${input.contextEventId}`)
    .digest("hex")
    .slice(0, 24)}`;
  return recordWorkspaceCheckpoint({
    repositoryRoot: input.root,
    checkpoint: {
      schemaVersion: 1,
      type: "agent.workspace.checkpointed",
      eventId,
      workspaceId: workspace.workspaceId,
      generation: workspace.generation,
      workspaceRevision: workspace.revision,
      assignmentId: workspace.assignmentId,
      assignmentRevision,
      leaseGeneration: workspace.leaseGeneration,
      writerSessionId: input.inspection.binding.writerSessionId,
      headCommit: host.headCommit,
      treeHash: host.treeHash,
      changedPathSetDigest,
      changedPathCount,
      checkoutClean: host.clean === true,
      occurredAt: input.occurredAt,
    },
  });
}
