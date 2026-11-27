// Reconciliation (Lervo ADE coordination, "Reconciliation"): the paths a conversation's
// generation changed since its base are recorded as the generation's changed paths, which then
// hold them for every other claim, and the conflict-free ones outside the lease are claimed in one
// transition. Each conflict is reported with its holder.
import {
  conversationLeaseHolderWorkspaceIds,
  listWorkspaces,
  newestConversationWorkspace,
  readAssignment,
  readOrCreateClaimPathKey,
  recordConversationChangedPaths,
  widenConversationLease,
  type AgentWorkspace,
  type RecordedClaimRefusal,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import { listCheckoutChangedPaths } from "./checkout-changed-paths.js";
import type { ClaimHolder } from "./claim-contract.js";
import { claimWriterSessionId, type ClaimingConversation } from "./claim-conversation.js";
import { CLAIM_STORE_BUSY_MS, deferralCode, guardBeforeLock } from "./claim-deferral.js";
import { resolveClaimHolder } from "./claim-holder.js";
import { groupPaths, refusalGroups } from "./claim-refusal-groups.js";
import {
  conversationLeaseEventRecorder,
  conversationLeaseEventsWritable,
} from "./conversation-lease-events.js";

/** One holder's conflict with the generation's changed paths. */
export interface ReconciliationConflict {
  readonly code: string;
  readonly paths: readonly string[];
  readonly holder: ClaimHolder | null;
}

export type ConversationReconciliation =
  | {
      readonly status: "reconciled";
      /** How many claimable paths the generation changed. */
      readonly changedPathCount: number;
      readonly claimedPaths: readonly string[];
      readonly conflicts: readonly ReconciliationConflict[];
      /**
       * The changes fit no bound: the generation holds its top-level entries and claims nothing,
       * so no path was judged and no pending claim settles.
       */
      readonly overflow: boolean;
      /** The lead reacquired the lease under the next generation first. */
      readonly leaseRegenerated: boolean;
    }
  /** Nothing to reconcile: coordination is inactive, or the generation is no longer open. */
  | { readonly status: "skipped"; readonly code: string }
  /** Lervo could not reconcile now; the next reconciliation catches up. */
  | { readonly status: "deferred"; readonly code: string };

/** The states in which a generation's checkout still changes. */
const OPEN_STATES = new Set<AgentWorkspace["state"]>(["ready", "active", "paused"]);

/** What reconciliation reads besides the workforce; replaced in tests. */
export interface ReconciliationPorts {
  changedPaths: typeof listCheckoutChangedPaths;
}

const defaultPorts: ReconciliationPorts = { changedPaths: listCheckoutChangedPaths };

export interface ReconcileConversationInput {
  readonly conversation: ClaimingConversation;
  /**
   * Refusals already recorded for this session and these paths, such as this turn's hook refusals
   * and an earlier `Stop`'s conflicts, which record no event again.
   */
  readonly recordedRefusals: readonly RecordedClaimRefusal[];
  /** On the `performance.now()` clock: no scheduler lock is taken within 500 ms of it. */
  readonly deadline: number;
  readonly signal?: AbortSignal;
  readonly now?: Date;
  readonly ports?: ReconciliationPorts;
}

async function conflictsOf(
  repositoryRoot: string,
  refusals: Parameters<typeof refusalGroups>[0],
  workspaces: readonly AgentWorkspace[],
): Promise<ReconciliationConflict[]> {
  return Promise.all(
    refusalGroups(refusals).map(async (group) => ({
      code: group[0]!.code,
      paths: groupPaths(group),
      holder: await resolveClaimHolder({ repositoryRoot, refusal: group[0]!, workspaces }),
    })),
  );
}

/**
 * Reconciles the conversation's newest generation: lists what its checkout changed since the
 * generation's base, records it on the generation, and claims the conflict-free part under the
 * scheduler lock (`assignment.lease.widened` with `cause: reconcile`). A lead whose lease expired,
 * or which another of its sessions holds, reacquires it first; a lease with less than 5 minutes
 * left renews even when nothing new is claimed. Each conflict records `assignment.claim.refused`
 * once. It never throws: a failure defers to the next reconciliation.
 */
export async function reconcileConversationCheckout(
  input: ReconcileConversationInput,
): Promise<ConversationReconciliation> {
  try {
    return await reconcile(input, input.now ?? new Date());
  } catch (error) {
    return { status: "deferred", code: deferralCode(error) };
  }
}

async function reconcile(
  input: ReconcileConversationInput,
  now: Date,
): Promise<ConversationReconciliation> {
  const { conversation } = input;
  const { repositoryRoot } = conversation;
  const workspaces = await listWorkspaces(repositoryRoot);
  const generation = newestConversationWorkspace(workspaces, conversation.workspaceId);
  if (generation === null || generation.assignmentId !== conversation.assignmentId)
    return { status: "skipped", code: "workspace_not_found" };
  if (!OPEN_STATES.has(generation.state)) return { status: "skipped", code: "workspace_not_open" };
  const changed = await (input.ports ?? defaultPorts).changedPaths(conversation.worktree, {
    baseCommit: generation.baseCommit,
    integrationTargetDigest: generation.integrationTargetDigest,
    deadline: input.deadline,
  });
  if (changed === null) return { status: "deferred", code: "reconcile_unavailable" };
  const storage = await openProjectStorage(repositoryRoot, { busyTimeoutMs: CLAIM_STORE_BUSY_MS });
  try {
    if (!conversationLeaseEventsWritable(storage))
      return { status: "skipped", code: "coordination_inactive" };
    const recorded = await recordConversationChangedPaths({
      repositoryRoot,
      workspace: generation,
      changedPaths: changed.paths,
      measuredFrom: changed.measuredFrom,
      workspaces,
      now,
    });
    const assignment = await readAssignment(repositoryRoot, conversation.assignmentId);
    const result = await widenConversationLease({
      repositoryRoot,
      assignmentId: conversation.assignmentId,
      agentId: conversation.agentId,
      // The lead's live lease keeps its writer session; only an expired one is reacquired.
      sessionId: claimWriterSessionId(conversation, assignment.lease, now),
      paths: recorded.overflow ? [] : recorded.paths,
      mode: "reconcile",
      claimantWorkspaceId: conversation.workspaceId,
      regenerate: true,
      leaseHolderWorkspaceIds: conversationLeaseHolderWorkspaceIds(workspaces),
      recordedRefusals: input.recordedRefusals,
      claimPathKey: await readOrCreateClaimPathKey(repositoryRoot),
      recordEvent: conversationLeaseEventRecorder(storage),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      beforeLock: guardBeforeLock(input),
      now,
    });
    if (result.status === "deferred") return { status: "deferred", code: "claim_deferred" };
    return {
      status: "reconciled",
      changedPathCount: recorded.changedPathCount,
      claimedPaths: result.addedPaths,
      conflicts: await conflictsOf(repositoryRoot, result.refusals, workspaces),
      overflow: recorded.overflow,
      leaseRegenerated: result.leaseRegenerated,
    };
  } finally {
    await storage.close();
  }
}
