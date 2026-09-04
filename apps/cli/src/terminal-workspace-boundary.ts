import { createHash } from "node:crypto";

import {
  assertAssignmentExecutionAuthority,
  listAssignments,
  type AgentWorkspace,
} from "@lervo/agent-workforce";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import type { WorkspaceOwnershipMarker } from "@lervo/workspace-host";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function terminalWorkspaceDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function terminalWriterSessionId(
  provider: "codex" | "claude",
  providerSessionId: string,
): string {
  return `ses_terminal_${createHash("sha256")
    .update(`${provider}\0${providerSessionId}`)
    .digest("hex")
    .slice(0, 24)}`;
}

export function terminalWorkspaceMarker(workspace: AgentWorkspace): WorkspaceOwnershipMarker {
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

export function terminalWorkspaceHost(workspace: AgentWorkspace): GitWorkspaceHostAdapter {
  if (workspace.host.kind !== "git")
    throw new Error("The workspace host adapter is not available to direct terminal integration.");
  const host = new GitWorkspaceHostAdapter();
  if (host.version !== workspace.host.version)
    throw new Error("The workspace host adapter version changed before terminal attachment.");
  return host;
}

export async function terminalWorkspaceAssignment(input: {
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
