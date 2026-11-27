import {
  CONVERSATION_WORKTREE_GONE,
  retireConversation,
  type ConversationCheckoutRemoval,
} from "./conversation-retirement.js";
import {
  conversationWorkspaceGenerations,
  isConversationWorkspace,
} from "./conversation-workspace.js";
import { AgentWorkforceError, type WorkforceEventRecorder } from "./types.js";
import { listWorkspaces } from "./workspace-store.js";
import type { AgentWorkspace, WorkspaceState } from "./workspace-types.js";

/** States of a generation that still holds its lease and changed paths while its worktree exists. */
const OPEN: ReadonlySet<WorkspaceState> = new Set(["ready", "active", "paused"]);
/** The most conversations one sweep retires; the next sweep finishes the rest. */
const MAXIMUM_SWEPT_CONVERSATIONS = 64;

/** What the host proves of one generation's checkout. */
export type ConversationCheckoutProof = (
  workspace: AgentWorkspace,
) => Promise<ConversationCheckoutRemoval>;

/** What one sweep changed. */
export interface GoneConversationSweep {
  /** The conversations whose coordination the sweep ended. */
  retiredConversationIds: string[];
  cancelledAssignmentIds: string[];
  removedWorkspaceIds: string[];
}

function proven(checkout: ConversationCheckoutRemoval): boolean {
  return checkout.hostAbsent && checkout.gitMetadataAbsent;
}

/** Whether the host proves every live generation's checkout gone, asking no further after one stays. */
async function checkoutsGone(
  live: readonly AgentWorkspace[],
  prove: ConversationCheckoutProof,
): Promise<boolean> {
  for (const workspace of live) if (!proven(await prove(workspace))) return false;
  return true;
}

/**
 * Ends the coordination of conversations whose worktree vanished without a retire (Lervo ADE
 * coordination, "Lease lifetime"): a conversation with a `ready`, `active`, or `paused` generation
 * whose every live generation's checkout the host proves gone, directory and Git registration
 * both, retires as an explicit retire would, with the reason `conversation_worktree_gone`. A
 * conversation whose checkout stays, or whose sealed change waits for integration, is left as it
 * is. It runs whatever the coordination gate says: the gate decides only what starts.
 */
export async function sweepGoneConversations(input: {
  repositoryRoot: string;
  proveCheckoutRemoved: ConversationCheckoutProof;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<GoneConversationSweep> {
  const workspaces = await listWorkspaces(input.repositoryRoot);
  const candidates = [
    ...new Set(
      workspaces
        .filter((workspace) => isConversationWorkspace(workspace) && OPEN.has(workspace.state))
        .map((workspace) => workspace.conversationId!),
    ),
  ].sort();
  const sweep: GoneConversationSweep = {
    retiredConversationIds: [],
    cancelledAssignmentIds: [],
    removedWorkspaceIds: [],
  };
  for (const conversationId of candidates) {
    if (sweep.retiredConversationIds.length >= MAXIMUM_SWEPT_CONVERSATIONS) break;
    const live = conversationWorkspaceGenerations(workspaces, conversationId).filter(
      (workspace) => workspace.state !== "removed",
    );
    if (!(await checkoutsGone(live, input.proveCheckoutRemoved))) continue;
    const retired = await retireConversation({
      repositoryRoot: input.repositoryRoot,
      conversationId,
      checkout: { hostAbsent: true, gitMetadataAbsent: true },
      reason: CONVERSATION_WORKTREE_GONE,
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    }).catch((error: unknown) => {
      if (error instanceof AgentWorkforceError && error.code === "workspace_integration_pending")
        return null;
      throw error;
    });
    if (retired === null) continue;
    sweep.retiredConversationIds.push(conversationId);
    sweep.cancelledAssignmentIds.push(...retired.cancelledAssignmentIds);
    sweep.removedWorkspaceIds.push(...retired.removedWorkspaceIds);
  }
  return sweep;
}
