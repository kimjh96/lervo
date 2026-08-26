import { listWorkspaces } from "@lervo/agent-workforce";
import type { WorkspaceCleanupHostAdapter } from "@lervo/workspace-host";

import { applyWorkspaceCleanup } from "./workspace-cleanup-apply.js";
import type { WorkspaceCleanupReceipt } from "./workspace-cleanup-contract.js";
import { planWorkspaceCleanup } from "./workspace-cleanup-plan.js";

export interface AutomaticWorkspaceCleanupPolicy {
  enabled: boolean;
  integrationTargetRef: string;
}

export interface AutomaticWorkspaceCleanupResult {
  status: "disabled" | "complete" | "pending";
  removed: WorkspaceCleanupReceipt[];
  pending: Array<{ workspaceId: string; reasons: string[] }>;
}

export async function reconcileAutomaticWorkspaceCleanup(input: {
  repositoryRoot: string;
  policy: AutomaticWorkspaceCleanupPolicy;
  hostFor(kind: "git" | "orca", version: string): WorkspaceCleanupHostAdapter | null;
  now?: Date;
}): Promise<AutomaticWorkspaceCleanupResult> {
  if (!input.policy.enabled) return { status: "disabled", removed: [], pending: [] };
  const removed: WorkspaceCleanupReceipt[] = [];
  const pending: AutomaticWorkspaceCleanupResult["pending"] = [];
  const candidates = (await listWorkspaces(input.repositoryRoot)).filter((workspace) =>
    ["integrated", "cleanup_eligible"].includes(workspace.state),
  );
  for (const workspace of candidates) {
    const host = input.hostFor(workspace.host.kind, workspace.host.version);
    if (workspace.ownerWorkspacePath === undefined || host === null) {
      pending.push({
        workspaceId: workspace.workspaceId,
        reasons: [
          workspace.ownerWorkspacePath === undefined
            ? "private_coordinate_absent"
            : "host_adapter_unavailable",
        ],
      });
      continue;
    }
    const coordinates = {
      repositoryRoot: input.repositoryRoot,
      workspacePath: workspace.ownerWorkspacePath,
      integrationTargetRef: input.policy.integrationTargetRef,
    };
    const plan = await planWorkspaceCleanup({
      coordinates,
      workspaceId: workspace.workspaceId,
      host,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    if (plan.status === "blocked") {
      pending.push({ workspaceId: workspace.workspaceId, reasons: plan.blockedReasons });
      continue;
    }
    removed.push(
      await applyWorkspaceCleanup({
        plan,
        coordinates,
        host,
        ...(input.now === undefined ? {} : { now: input.now }),
      }),
    );
  }
  return { status: pending.length === 0 ? "complete" : "pending", removed, pending };
}
