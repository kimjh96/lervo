// The workforce stage's upkeep after its migration, run while the repository is not held: each
// agent's origin recorded once (ADR-0643), and the sweep of conversations whose worktree vanished
// without a retire (Lervo ADE coordination, "Lease lifetime").
import { recordPendingAgentOrigins } from "./agent-origin-stage.js";
import { sweepGoneConversationWorktrees } from "./conversation-worktree-sweep.js";
import type { UpgradeReceipt } from "./upgrade-format.js";

export async function applyWorkforceUpkeep(
  root: string,
  receipt: Pick<UpgradeReceipt, "appliedStages" | "skippedStages">,
): Promise<void> {
  if ((await recordPendingAgentOrigins(root)) > 0) receipt.appliedStages.push("workforce_origins");
  const sweep = await sweepGoneConversationWorktrees(root);
  if (sweep.retiredConversationCount > 0) receipt.appliedStages.push("conversation_worktree_sweep");
  if (sweep.failure !== undefined)
    receipt.skippedStages.push({ stage: "conversation_worktree_sweep", reason: sweep.failure });
}
