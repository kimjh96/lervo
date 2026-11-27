// When a conversation reconciles (Lervo ADE coordination, "Reconciliation"): at the turn's `Stop`,
// whose first run blocks once on a conflict and whose second run lets the turn end, and when the
// resident observes the lead session's exit, which no `Stop` may have followed.
import type { TerminalIntegrationProvider } from "@lervo/repository-knowledge";

import {
  defaultClaimingConversationPorts,
  findClaimingConversation,
  type ClaimingConversationPorts,
} from "./claim-conversation.js";
import { recordedRefusalsOf, turnRefusals } from "./claim-turn-refusals.js";
import { readPendingClaims, settleReconciledClaims } from "./conversation-claim-settlement.js";
import {
  reconcileConversationCheckout,
  type ConversationReconciliation,
  type ReconciliationPorts,
} from "./conversation-reconciliation.js";
import { reconciliationMessage } from "./reconciliation-message.js";

/** How long a `Stop` may spend before its reconciliation takes no scheduler lock. */
export const STOP_RECONCILIATION_MS = 3_000;
/** How long the reconciliation at a session's exit may spend before it takes no lock. */
const EXIT_RECONCILIATION_MS = 10_000;

export interface TurnReconciliationInput {
  readonly provider: TerminalIntegrationProvider;
  readonly providerSessionId: string;
  readonly workingDirectory: string;
  /**
   * `Stop`'s second run, with `stop_hook_active`, or the session's exit: what still conflicts
   * becomes `unresolved`, and nothing blocks. Otherwise a conflict blocks the `Stop` once.
   */
  readonly final: boolean;
  /** On the `performance.now()` clock. */
  readonly deadline: number;
  readonly now?: Date;
  readonly ports?: ClaimingConversationPorts;
  readonly reconciliationPorts?: ReconciliationPorts;
}

export interface TurnReconciliation {
  /** The `Stop` block's reason, or null when the turn may end. */
  readonly blockReason: string | null;
  /** Null when the session writes for no conversation whose coordination is active. */
  readonly reconciliation: ConversationReconciliation | null;
}

const NOTHING: TurnReconciliation = { blockReason: null, reconciliation: null };

/**
 * Reconciles the conversation the session writes for, settles the session's pending claims in the
 * claim log, and answers whether the `Stop` blocks. A session that writes for no conversation, or
 * a closed coordination gate, reconciles nothing. It never throws: a failure lets the turn end, and
 * the next reconciliation catches up.
 */
export async function reconcileConversationTurn(
  input: TurnReconciliationInput,
): Promise<TurnReconciliation> {
  try {
    const conversation = await findClaimingConversation(
      {
        provider: input.provider,
        providerSessionId: input.providerSessionId,
        workingDirectory: input.workingDirectory,
      },
      input.ports ?? defaultClaimingConversationPorts,
    );
    if (conversation === null) return NOTHING;
    const now = input.now ?? new Date();
    const pending = readPendingClaims(input.providerSessionId, conversation.workspaceId);
    // An earlier `Stop`'s conflicts already recorded their events, as this turn's refusals did.
    const recordedRefusals = [
      ...(await turnRefusals(conversation.repositoryRoot, input.provider, input.providerSessionId)),
      ...recordedRefusalsOf(pending.filter((entry) => entry.decision === "deny")),
    ];
    const reconciliation = await reconcileConversationCheckout({
      conversation,
      recordedRefusals,
      deadline: input.deadline,
      now,
      ...(input.reconciliationPorts === undefined ? {} : { ports: input.reconciliationPorts }),
    });
    if (reconciliation.status !== "reconciled") return { blockReason: null, reconciliation };
    await settleReconciledClaims({
      providerSessionId: input.providerSessionId,
      workspaceId: conversation.workspaceId,
      conflicts: reconciliation.conflicts,
      final: input.final,
      now,
    }).catch(() => undefined);
    return {
      blockReason:
        input.final || reconciliation.conflicts.length === 0
          ? null
          : reconciliationMessage(reconciliation.conflicts),
      reconciliation,
    };
  } catch {
    return NOTHING;
  }
}

/**
 * Reconciles the conversation of a hosted session that exited (`session.exited`), since a crash
 * or a killed process runs no `Stop`. Only a lead's session reconciles; what still conflicts then
 * becomes `unresolved`. It never throws.
 */
export async function reconcileExitedSession(
  providerSessionId: string,
  ports: ClaimingConversationPorts = defaultClaimingConversationPorts,
): Promise<TurnReconciliation> {
  const launch = await ports.launchOfSession(providerSessionId).catch(() => null);
  if (launch === null || (launch.provider !== "claude" && launch.provider !== "codex"))
    return NOTHING;
  return reconcileConversationTurn({
    provider: launch.provider,
    providerSessionId,
    workingDirectory: process.cwd(),
    final: true,
    deadline: performance.now() + EXIT_RECONCILIATION_MS,
    // The launch is known, so finding the conversation reads no other session's launch.
    ports: { ...ports, launchOfSession: () => Promise.resolve(launch) },
  });
}

/**
 * The `Stop` answer's block reason for the session's conversation, or null. Its first run blocks
 * once on a conflict; its second run, with `stop_hook_active`, lets the turn end.
 */
export async function reconcileAtStop(input: {
  readonly provider: TerminalIntegrationProvider;
  readonly providerSessionId: string;
  readonly workingDirectory: string;
  readonly stopHookActive: boolean;
}): Promise<string | null> {
  const { blockReason } = await reconcileConversationTurn({
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    workingDirectory: input.workingDirectory,
    final: input.stopHookActive,
    deadline: performance.now() + STOP_RECONCILIATION_MS,
  });
  return blockReason;
}
