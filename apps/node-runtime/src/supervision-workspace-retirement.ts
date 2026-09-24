import { randomBytes } from "node:crypto";
import {
  listAssignments,
  readWorkspace,
  updateWorkspace,
  type AgentWorkspace,
} from "@lervo/agent-workforce";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { observeUnstartedSupervisionWorkspace } from "./supervision-unstarted-workspace.js";

const RETIREMENT = "unstarted_retirement";

type WorkspaceOwnershipMarker = Parameters<GitWorkspaceHostAdapter["remove"]>[0]["marker"];

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

const id = (prefix: "evt" | "idk") => `${prefix}_${randomBytes(16).toString("hex")}`;

/**
 * Retires one checkout only after a fresh proof that no worker ever used it. The record is first
 * fenced out of use, then Git removes the worktree without force, so a dirty or changed checkout
 * is refused. A rerun resumes an interrupted retirement; nothing else is removed.
 */
export async function retireUnstartedSupervisionWorkspace(input: {
  repositoryRoot: string;
  binding: NodeSupervisionBinding;
  workspaceId: string;
  now?: () => string;
}): Promise<{ workspaceId: string; status: "removed" | "already_removed" }> {
  const now = input.now ?? (() => new Date().toISOString());
  let stored = await readWorkspace(input.repositoryRoot, input.workspaceId);
  if (stored === null) throw new Error("The workspace record is absent.");
  if (stored.workspace.state === "removed")
    return { workspaceId: input.workspaceId, status: "already_removed" };
  if (stored.workspace.state === "ready") {
    const assignment = (await listAssignments(input.repositoryRoot)).find(
      (item) => item.assignmentId === stored!.workspace.assignmentId,
    );
    const proof =
      assignment === undefined
        ? null
        : await observeUnstartedSupervisionWorkspace({
            repositoryRoot: input.repositoryRoot,
            binding: input.binding,
            assignment,
            workspace: stored.workspace,
            now,
          });
    if (proof === null) throw new Error("The workspace has no fresh proof that it was never used.");
    stored = await updateWorkspace({
      repositoryRoot: input.repositoryRoot,
      workspaceId: input.workspaceId,
      expectedContentHash: stored.contentHash,
      expectedRevision: stored.workspace.revision,
      expectedGeneration: stored.workspace.generation,
      nextState: "recovery_required",
      occurredAt: now(),
      recoveryReason: RETIREMENT,
      reasonCode: RETIREMENT,
      eventId: id("evt"),
    });
  }
  const workspace = stored.workspace;
  if (
    workspace.state !== "recovery_required" ||
    workspace.recoveryReason !== RETIREMENT ||
    workspace.ownerWorkspacePath === undefined ||
    workspace.host.kind !== "git"
  )
    throw new Error("Only a never-used Git checkout under retirement can be removed.");
  const after = await new GitWorkspaceHostAdapter().remove({
    repositoryRoot: input.repositoryRoot,
    workspacePath: workspace.ownerWorkspacePath,
    baseCommit: workspace.baseCommit,
    marker: markerFor(workspace),
    idempotencyKey: id("idk"),
  });
  if (after.status !== "absent") throw new Error("Git did not prove the checkout was removed.");
  await updateWorkspace({
    repositoryRoot: input.repositoryRoot,
    workspaceId: input.workspaceId,
    expectedContentHash: stored.contentHash,
    expectedRevision: workspace.revision,
    expectedGeneration: workspace.generation,
    nextState: "removed",
    occurredAt: now(),
    evidence: { hostAbsent: true, gitMetadataAbsent: true },
    reasonCode: RETIREMENT,
    eventId: id("evt"),
  });
  return { workspaceId: input.workspaceId, status: "removed" };
}
