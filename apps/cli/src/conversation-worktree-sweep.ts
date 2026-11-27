// The upgrade's sweep of conversations whose worktree vanished without a retire (Lervo ADE
// coordination, "Lease lifetime"). It runs whatever the coordination gate says, since it only
// ends coordination that already exists, and a repository without a coordination home pays one
// read-only inspection.
import { AgentWorkforceError, sweepGoneConversations } from "@lervo/agent-workforce";
import { inspectRepositoryCoordinationHome } from "@lervo/project-storage";

import { conversationCheckoutRemoval } from "./conversation-checkout-removal.js";
import { mutateWorkforceState } from "./workforce-mutation.js";

/** What the sweep did: how many conversations it retired, or why it stopped. */
export interface ConversationWorktreeSweepOutcome {
  retiredConversationCount: number;
  /** The failure's code; a failed sweep never fails the upgrade, and the next one retries. */
  failure?: string;
}

export async function sweepGoneConversationWorktrees(
  root: string,
): Promise<ConversationWorktreeSweepOutcome> {
  try {
    if ((await inspectRepositoryCoordinationHome(root)) === null)
      return { retiredConversationCount: 0 };
    const sweep = await mutateWorkforceState(root, (recordEvent) =>
      sweepGoneConversations({
        repositoryRoot: root,
        proveCheckoutRemoved: (workspace) => conversationCheckoutRemoval(root, workspace),
        recordEvent,
      }),
    );
    return { retiredConversationCount: sweep.retiredConversationIds.length };
  } catch (error) {
    return {
      retiredConversationCount: 0,
      failure: error instanceof AgentWorkforceError ? error.code : "conversation_sweep_failed",
    };
  }
}
