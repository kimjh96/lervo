import type { ChangedPathHolder } from "./assignment-path-conflict.js";
import { validChangedPathHolder } from "./conversation-claim-input.js";
import { isConversationWorkspace } from "./conversation-workspace.js";
import type { AgentWorkspace, WorkspaceState } from "./workspace-types.js";

/** States whose changed paths hold until the generation seals (`path_changed_unsealed`). */
const UNSEALED: ReadonlySet<WorkspaceState> = new Set(["ready", "active", "paused"]);
/** States whose sealed change holds its paths until it integrates (`path_awaiting_integration`). */
const AWAITING_INTEGRATION: ReadonlySet<WorkspaceState> = new Set([
  "sealed",
  "integration_pending",
  "integrating",
  "integration_conflict",
]);

/**
 * The paths an unsealed generation changed since its base, as its latest reconciliation recorded
 * them. The turn's reconciliation records them, and it has not landed: until it does, no record
 * holds any, and an unsealed change holds its paths only through its lease.
 */
function unsealedChangedPaths(_workspace: AgentWorkspace): readonly string[] {
  return [];
}

/** What a generation's change holds in its state, or null once it holds nothing. */
function heldPaths(
  workspace: AgentWorkspace,
): { code: ChangedPathHolder["code"]; paths: readonly string[] } | null {
  if (UNSEALED.has(workspace.state))
    return { code: "path_changed_unsealed", paths: unsealedChangedPaths(workspace) };
  if (AWAITING_INTEGRATION.has(workspace.state))
    return {
      code: "path_awaiting_integration",
      paths: workspace.sealedResult?.changedPaths ?? [],
    };
  return null;
}

/**
 * Other conversations' changed and sealed paths as holders of a claim (Lervo ADE coordination,
 * "Conflicts"). The claimant's own generations never count. A path a record holds that the claim
 * policy would not name, such as `.`, is left out rather than failing every claim.
 */
export function conversationChangedPathHolders(
  workspaces: readonly AgentWorkspace[],
  claimantConversationId: string,
): ChangedPathHolder[] {
  const holders: ChangedPathHolder[] = [];
  for (const workspace of workspaces) {
    if (!isConversationWorkspace(workspace) || workspace.conversationId === claimantConversationId)
      continue;
    const held = heldPaths(workspace);
    if (held === null) continue;
    const { code, paths } = held;
    for (const path of paths) {
      const holder: ChangedPathHolder = {
        path,
        holderAgentId: workspace.agentId,
        holderWorkspaceId: workspace.conversationId!,
        holderAssignmentId: workspace.assignmentId,
        code,
      };
      if (validChangedPathHolder(holder)) holders.push(holder);
    }
  }
  return holders;
}

/**
 * The conversation workspace of each conversation assignment, keyed by assignment ID, so a
 * refusal by a live lease names where its holder works.
 */
export function conversationLeaseHolderWorkspaceIds(
  workspaces: readonly AgentWorkspace[],
): Map<string, string> {
  const owners = new Map<string, string>();
  for (const workspace of workspaces)
    if (isConversationWorkspace(workspace) && workspace.state !== "removed")
      owners.set(workspace.assignmentId, workspace.conversationId!);
  return owners;
}
