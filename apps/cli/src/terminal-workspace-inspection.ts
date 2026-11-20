import { partitionWorkspaceChanges, readWorkspace } from "@lervo/agent-workforce";
import type { WorkspaceHostInspection } from "@lervo/workspace-host";

import {
  terminalWorkspaceAssignment,
  terminalWorkspaceDigest,
  terminalWorkspaceHost,
  terminalWorkspaceMarker,
  terminalWriterSessionId,
} from "./terminal-workspace-boundary.js";
import type {
  TerminalWorkspaceBinding,
  TerminalWorkspaceInspection,
} from "./terminal-workspace-contract.js";

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
  const sessionId = terminalWriterSessionId(input.provider, input.providerSessionId);
  if (
    workspace.state !== "active" ||
    workspace.writerSession?.sessionId !== input.binding.writerSessionId ||
    sessionId !== input.binding.writerSessionId
  )
    issues.push({ code: "writer_lease_lost", command: "lervo workspace inspect --json" });
  let assignmentRevision: number | null = null;
  let expectedPaths: string[] = [];
  try {
    const assignment = await terminalWorkspaceAssignment({
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
    const expectedMarker = terminalWorkspaceMarker(workspace);
    if (terminalWorkspaceDigest(expectedMarker) !== workspace.markerHash)
      throw new Error("Workspace marker hash mismatch.");
    host = await terminalWorkspaceHost(workspace).inspect({
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
        runtimeExcludedPaths: [".lervo/state", ".lervo/data", ".lervo/run"],
      });
      if (partition.outsideScope.length > 0)
        issues.push({ code: "workspace_path_escape", command: "lervo workspace inspect --json" });
      changedPathSetDigest = terminalWorkspaceDigest(partition.expected);
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
