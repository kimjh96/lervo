import { randomBytes } from "node:crypto";

import { listWorkspaces, readWorkspace, updateWorkspace } from "@lervo/agent-workforce";
import { repositoryCoordinateDigest } from "@lervo/project-storage";
import type { WorkspaceHostInspection } from "@lervo/workspace-host";

import {
  terminalWorkspaceAssignment,
  terminalWorkspaceDigest,
  terminalWorkspaceHost,
  terminalWorkspaceMarker,
  terminalWriterSessionId,
} from "./terminal-workspace-boundary.js";
import {
  terminalWorkspaceIsolationFailure,
  type TerminalWorkspaceBinding,
} from "./terminal-workspace-contract.js";

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
    terminalWorkspaceIsolationFailure(
      "shared_workspace_mutation",
      "Multiple active workspace generations claim this checkout.",
    );
  let workspace = matches[0]!;
  const expectedMarker = terminalWorkspaceMarker(workspace);
  if (terminalWorkspaceDigest(expectedMarker) !== workspace.markerHash)
    terminalWorkspaceIsolationFailure(
      "workspace_marker_mismatch",
      "The workspace marker binding is invalid.",
    );
  const now = input.now ?? new Date();
  try {
    await terminalWorkspaceAssignment({
      root: input.root,
      workspace,
      provider: input.provider,
      now,
    });
  } catch (error) {
    terminalWorkspaceIsolationFailure(
      "assignment_scope_changed",
      "The workspace assignment lease is not current.",
      error,
    );
  }
  let inspected: WorkspaceHostInspection;
  try {
    inspected = await terminalWorkspaceHost(workspace).inspect({
      repositoryRoot: input.root,
      workspacePath: input.root,
      baseCommit: workspace.baseCommit,
      marker: expectedMarker,
    });
  } catch (error) {
    terminalWorkspaceIsolationFailure(
      "workspace_marker_mismatch",
      "The workspace host inspection failed.",
      error,
    );
  }
  if (inspected.status !== "present" || !inspected.markerMatched)
    terminalWorkspaceIsolationFailure(
      "workspace_marker_mismatch",
      "The terminal checkout does not match its workspace marker.",
    );
  const sessionId = terminalWriterSessionId(input.provider, input.providerSessionId);
  let attachmentDisposition: TerminalWorkspaceBinding["attachmentDisposition"];
  if (workspace.state === "ready" || workspace.state === "paused") {
    const resumed = workspace.state === "paused";
    const stored = await readWorkspace(input.root, workspace.workspaceId);
    if (stored === null)
      terminalWorkspaceIsolationFailure(
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
        writerSession: {
          sessionId,
          startedAt: now.toISOString(),
          lastSeenAt: now.toISOString(),
        },
      })
    ).workspace;
    attachmentDisposition = resumed ? "resumed" : "activated";
  } else if (workspace.state !== "active" || workspace.writerSession?.sessionId !== sessionId) {
    terminalWorkspaceIsolationFailure(
      "writer_lease_lost",
      "The workspace is not writable by this terminal session.",
    );
  } else {
    const stored = await readWorkspace(input.root, workspace.workspaceId);
    if (stored === null)
      terminalWorkspaceIsolationFailure(
        "workspace_marker_mismatch",
        "The workspace record disappeared before its writer heartbeat.",
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
        writerSession: {
          ...workspace.writerSession,
          lastSeenAt: now.toISOString(),
        },
        reasonCode: "terminal_writer_observed",
      })
    ).workspace;
    attachmentDisposition = "continued";
  }
  return {
    executionKind: workspace.executionKind,
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.generation,
    workspaceRevision: workspace.revision,
    assignmentId: workspace.assignmentId,
    leaseGeneration: workspace.leaseGeneration,
    writerSessionId: sessionId,
    attachmentDisposition,
  };
}
