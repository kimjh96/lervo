import { createHash, randomBytes } from "node:crypto";

import {
  readWorkspace,
  recordWorkspaceCheckpoint,
  updateWorkspace,
  type AgentWorkspace,
  type WorkspaceCheckpoint,
} from "@lervo/agent-workforce";

import type { TerminalWorkspaceInspection } from "./terminal-workspace-contract.js";

export async function pauseTerminalWorkspace(input: {
  root: string;
  inspection: TerminalWorkspaceInspection;
  checkpoint: WorkspaceCheckpoint;
  occurredAt: string;
}): Promise<AgentWorkspace> {
  const { workspace, binding } = input.inspection;
  if (
    input.inspection.issues.length > 0 ||
    workspace === null ||
    workspace.state !== "active" ||
    workspace.workspaceId !== input.checkpoint.workspaceId ||
    workspace.revision !== input.checkpoint.workspaceRevision ||
    workspace.writerSession?.sessionId !== binding.writerSessionId ||
    input.checkpoint.writerSessionId !== binding.writerSessionId
  )
    throw new Error("The terminal workspace cannot pause without its exact current checkpoint.");
  const stored = await readWorkspace(input.root, workspace.workspaceId);
  if (stored === null) throw new Error("The terminal workspace disappeared before pause.");
  return (
    await updateWorkspace({
      repositoryRoot: input.root,
      workspaceId: workspace.workspaceId,
      expectedContentHash: stored.contentHash,
      eventId: `evt_${randomBytes(12).toString("hex")}`,
      expectedRevision: workspace.revision,
      expectedGeneration: workspace.generation,
      nextState: "paused",
      occurredAt: input.occurredAt,
      evidence: { writerFrozen: true },
      writerSession: null,
      reasonCode: "terminal_turn_checkpointed",
    })
  ).workspace;
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
