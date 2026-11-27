import type { ChangedPathHolder } from "./assignment-path-conflict.js";
import { validChangedPathHolder } from "./conversation-claim-input.js";
import { readUnsealedChangedPathHolders } from "./conversation-changed-paths.js";
import { isConversationWorkspace } from "./conversation-workspace.js";
import type { WorkforceAssignment } from "./types.js";
import { listWorkspaces } from "./workspace-store.js";
import type { AgentWorkspace, WorkspaceState } from "./workspace-types.js";

/** States whose sealed change holds its paths until it integrates (`path_awaiting_integration`). */
const AWAITING_INTEGRATION: ReadonlySet<WorkspaceState> = new Set([
  "sealed",
  "integration_pending",
  "integrating",
  "integration_conflict",
]);

/**
 * Other conversations' sealed changes as holders of a claim (Lervo ADE coordination,
 * "Conflicts"), from their sealed results. The claimant's own generations never count. Unsealed
 * changes hold through their recorded changed paths instead (`readUnsealedChangedPathHolders`).
 * A path a record holds that the claim policy would not name is left out rather than failing
 * every claim.
 */
export function conversationChangedPathHolders(
  workspaces: readonly AgentWorkspace[],
  claimantConversationId: string | null,
): ChangedPathHolder[] {
  const holders: ChangedPathHolder[] = [];
  for (const workspace of workspaces) {
    if (
      !isConversationWorkspace(workspace) ||
      workspace.conversationId === claimantConversationId ||
      !AWAITING_INTEGRATION.has(workspace.state)
    )
      continue;
    for (const path of workspace.sealedResult?.changedPaths ?? []) {
      const holder: ChangedPathHolder = {
        path,
        holderAgentId: workspace.agentId,
        holderWorkspaceId: workspace.conversationId!,
        holderAssignmentId: workspace.assignmentId,
        code: "path_awaiting_integration",
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

/**
 * Other conversations' sealed and unsealed changes as holders of a conversation's claim, read at
 * the moment of the claim under the scheduler lock.
 */
export async function readConversationPathHolders(input: {
  repositoryRoot: string;
  workforceDirectory: string;
  claimantConversationId: string | null;
  assignments: readonly WorkforceAssignment[];
  now: Date;
}): Promise<ChangedPathHolder[]> {
  const [workspaces, unsealed] = await Promise.all([
    listWorkspaces(input.repositoryRoot),
    readUnsealedChangedPathHolders(input),
  ]);
  return [...conversationChangedPathHolders(workspaces, input.claimantConversationId), ...unsealed];
}

/**
 * The conversation holders `claimAssignment` judges besides live leases, so Lervo's own agents
 * never take a path a conversation's unsealed change holds. An assignment without paths reads
 * nothing, and so does a repository where no conversation reconciled, which only an open
 * coordination gate does. Nothing here ever fails the claim: a holder it cannot read holds
 * nothing. Sealed conversation generations arrive with sealing, which adds them here.
 */
export async function readAssignmentClaimPathHolders(input: {
  repositoryRoot: string;
  workforceDirectory: string;
  paths: readonly string[];
  assignments: readonly WorkforceAssignment[];
  now: Date;
}): Promise<ChangedPathHolder[]> {
  if (input.paths.length === 0) return [];
  return readUnsealedChangedPathHolders({ ...input, claimantConversationId: null }).catch(() => []);
}
