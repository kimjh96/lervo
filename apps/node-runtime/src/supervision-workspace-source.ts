import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { repositoryPathWithinScope } from "@lervo/work-controller";
import { currentSupervisionWorkspaces } from "./supervision-workspace-generations.js";
import { readWorkspace, type WorkforceAssignment } from "@lervo/agent-workforce";
import {
  repositoryCoordinateDigest,
  resolveRepositoryCoordinationHome,
  type ProjectStorage,
} from "@lervo/project-storage";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { operatingContractHash } from "@lervo/work-controller";
import { NodeSupervisionError } from "./supervision-authority.js";

export async function readSupervisionWorkspaceSource(
  repositoryRoot: string,
  assignment: WorkforceAssignment,
  binding?: NodeSupervisionBinding,
  storage?: ProjectStorage,
) {
  const candidates = await currentSupervisionWorkspaces(
    repositoryRoot,
    assignment,
    binding,
    storage,
  );
  if (candidates.length !== 1 || assignment.lease === null)
    throw new NodeSupervisionError("supervision_readiness_changed");
  const workspace = candidates[0]!;
  const home = await resolveRepositoryCoordinationHome(repositoryRoot);
  const host = new GitWorkspaceHostAdapter();
  if (
    workspace.projectId !== assignment.projectId ||
    workspace.agentId !== assignment.assigneeAgentId ||
    workspace.leaseGeneration !== assignment.lease.generation ||
    workspace.repositoryInstanceId !== home.repositoryInstanceId ||
    workspace.executionKind !== "worker" ||
    !["ready", "paused", "active"].includes(workspace.state) ||
    workspace.recoveryReason !== null ||
    workspace.ownerWorkspacePath === undefined ||
    (workspace.state === "active"
      ? workspace.writerSession?.sessionId !== assignment.lease.sessionId
      : workspace.writerSession !== null) ||
    workspace.pathDigest !== repositoryCoordinateDigest(workspace.ownerWorkspacePath) ||
    workspace.host.nativeInstanceDigest === null ||
    workspace.host.kind !== host.kind ||
    workspace.host.version !== host.version
  )
    throw new NodeSupervisionError("supervision_readiness_changed");
  const marker = {
    schemaVersion: 1 as const,
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
    repositoryInstanceId: workspace.repositoryInstanceId,
    adapterKind: workspace.host.kind,
    adapterVersion: workspace.host.version,
    creationPlanId: workspace.creationPlanId,
    pathDigest: workspace.pathDigest,
  };
  if (operatingContractHash(marker) !== workspace.markerHash)
    throw new NodeSupervisionError("supervision_readiness_changed");
  const observed = await host.inspectResult({
    repositoryRoot,
    workspacePath: workspace.ownerWorkspacePath,
    baseCommit: workspace.baseCommit,
    marker,
  });
  const confirmed = await readWorkspace(repositoryRoot, workspace.workspaceId);
  if (
    observed.status !== "present" ||
    !observed.markerMatched ||
    observed.baseCommitReachable !== true ||
    observed.gitOperationInProgress !== false ||
    observed.changedPaths === null ||
    observed.nativeInstanceDigest !== workspace.host.nativeInstanceDigest ||
    observed.changedPaths.some(
      (path) => !assignment.expectedPaths.some((scope) => repositoryPathWithinScope(path, scope)),
    ) ||
    confirmed === null ||
    operatingContractHash(confirmed.workspace) !== operatingContractHash(workspace)
  )
    throw new NodeSupervisionError("supervision_readiness_changed");
  return {
    evidenceHash: operatingContractHash({ workspace, observed }),
    workspacePath: workspace.ownerWorkspacePath,
  };
}
