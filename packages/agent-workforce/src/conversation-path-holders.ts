import type { ChangedPathHolder } from "./assignment-path-conflict.js";
import { validChangedPathHolder } from "./conversation-claim-input.js";
import {
  CHECKOUT_HOLDER_PATH as CHECKOUT,
  listConversationChangedPaths,
  type ConversationChangedPaths,
} from "./conversation-changed-paths.js";
import { isConversationWorkspace } from "./conversation-workspace.js";
import { listWorkspaces } from "./workspace-store.js";
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

/** The paths a recorded reconciliation holds for `workspace`, or none when it is not current. */
function unsealedChangedPaths(
  workspace: AgentWorkspace,
  changes: ReadonlyMap<string, ConversationChangedPaths>,
): readonly string[] {
  const recorded = changes.get(workspace.workspaceId);
  if (
    recorded === undefined ||
    recorded.generation !== workspace.generation ||
    recorded.baseCommit !== workspace.baseCommit
  )
    return [];
  // A generation whose changes fit no bound holds its whole checkout.
  return recorded.overflow ? [CHECKOUT] : recorded.paths;
}

/** What a generation's change holds in its state, or null once it holds nothing. */
function heldPaths(
  workspace: AgentWorkspace,
  changes: ReadonlyMap<string, ConversationChangedPaths>,
): { code: ChangedPathHolder["code"]; paths: readonly string[] } | null {
  if (UNSEALED.has(workspace.state))
    return { code: "path_changed_unsealed", paths: unsealedChangedPaths(workspace, changes) };
  if (AWAITING_INTEGRATION.has(workspace.state))
    return {
      code: "path_awaiting_integration",
      // A sealed result never names the checkout as a whole.
      paths: (workspace.sealedResult?.changedPaths ?? []).filter((path) => path !== CHECKOUT),
    };
  return null;
}

/**
 * Other conversations' changed and sealed paths as holders of a claim (Lervo ADE coordination,
 * "Conflicts"): their sealed results' paths, and the paths each unsealed generation's latest
 * reconciliation recorded in `changes`. The claimant's own generations never count; a claim of
 * Lervo's own agents has no conversation. A path a record holds that the claim policy would not
 * name is left out rather than failing every claim.
 */
export function conversationChangedPathHolders(
  workspaces: readonly AgentWorkspace[],
  claimantConversationId: string | null,
  changes: ReadonlyMap<string, ConversationChangedPaths> = new Map(),
): ChangedPathHolder[] {
  const holders: ChangedPathHolder[] = [];
  for (const workspace of workspaces) {
    if (!isConversationWorkspace(workspace) || workspace.conversationId === claimantConversationId)
      continue;
    const held = heldPaths(workspace, changes);
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

/**
 * Other conversations' changed and sealed paths as holders, read at the moment of a claim: every
 * workspace record and every generation's recorded changes.
 */
export async function readConversationPathHolders(
  repositoryRoot: string,
  claimantConversationId: string | null,
): Promise<ChangedPathHolder[]> {
  const [workspaces, changes] = await Promise.all([
    listWorkspaces(repositoryRoot),
    listConversationChangedPaths(repositoryRoot),
  ]);
  return conversationChangedPathHolders(workspaces, claimantConversationId, changes);
}

/**
 * The holders `claimAssignment` judges besides live leases: other conversations' changed and
 * sealed paths, so Lervo's own agents never take a path a conversation's change holds. A
 * conversation's own assignment skips its own generations.
 */
export async function readAssignmentClaimPathHolders(
  repositoryRoot: string,
  claimantAssignmentId: string,
): Promise<{ changedPathHolders: ChangedPathHolder[]; claimantWorkspaceId: string | null }> {
  const [workspaces, changes] = await Promise.all([
    listWorkspaces(repositoryRoot),
    listConversationChangedPaths(repositoryRoot),
  ]);
  const claimantWorkspaceId =
    conversationLeaseHolderWorkspaceIds(workspaces).get(claimantAssignmentId) ?? null;
  return {
    changedPathHolders: conversationChangedPathHolders(workspaces, claimantWorkspaceId, changes),
    claimantWorkspaceId,
  };
}
