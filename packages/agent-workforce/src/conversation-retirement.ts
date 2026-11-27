import { randomUUID } from "node:crypto";

import { createAssignmentCancellationPlan } from "./assignment-graph.js";
import { cancelAssignment } from "./assignment-cancellation.js";
import { listAssignments } from "./assignment-state.js";
import { pruneConversationChangedPaths } from "./conversation-changed-paths.js";
import { conversationWorkspaceGenerations } from "./conversation-workspace.js";
import type { WorkforceEventRecorder } from "./types.js";
import { fail } from "./workforce-state-validation.js";
import { listWorkspaces, readWorkspace, updateWorkspace } from "./workspace-store.js";
import type { AgentWorkspace, WorkspaceState } from "./workspace-types.js";

/** The reason a retired conversation's records carry (Lervo ADE coordination, "State"). */
export const CONVERSATION_RETIRED = "conversation_retired";

/** States of a generation whose sealed change has not integrated yet, or is being sealed. */
const AWAITING_INTEGRATION: ReadonlySet<WorkspaceState> = new Set([
  "sealing",
  "sealed",
  "integration_pending",
  "integrating",
  "integration_conflict",
]);

/** What the host proved of the conversation's checkout before its records move to `removed`. */
export interface ConversationCheckoutRemoval {
  /** The checkout's directory no longer exists. */
  hostAbsent: boolean;
  /** Git no longer registers the checkout as a worktree. */
  gitMetadataAbsent: boolean;
}

/** What retiring a conversation changed. */
export interface ConversationRetirement {
  /** The conversation assignments whose cancellation retiring recorded. */
  cancelledAssignmentIds: string[];
  /** The generation records retiring moved to `removed`. */
  removedWorkspaceIds: string[];
}

/** The conversation's generations that are not `removed`, oldest first. */
async function liveGenerations(
  repositoryRoot: string,
  conversationId: string,
): Promise<{ workspaces: AgentWorkspace[]; live: AgentWorkspace[] }> {
  const workspaces = await listWorkspaces(repositoryRoot);
  const live = conversationWorkspaceGenerations(workspaces, conversationId).filter(
    (workspace) => workspace.state !== "removed",
  );
  return { workspaces, live };
}

/**
 * Refuses to retire a conversation whose sealed change waits for integration
 * (`workspace_integration_pending`), before anything is removed. A conversation without records
 * passes: it never claimed.
 */
export async function assertConversationRetirable(
  repositoryRoot: string,
  conversationId: string,
): Promise<void> {
  const { live } = await liveGenerations(repositoryRoot, conversationId);
  if (live.some((workspace) => AWAITING_INTEGRATION.has(workspace.state)))
    fail(
      "workspace_integration_pending",
      "A sealed change of the conversation waits for integration, so it is not retired.",
    );
}

/**
 * Retires a conversation whose checkout the host already removed (Lervo ADE coordination,
 * "Lease lifetime"): it cancels each conversation assignment that is not finished, ending a live
 * lease through a holder-bound cancellation that names the lease's exact agent and lease, then
 * moves each generation record to `recovery_required` and `removed` with the reason
 * `conversation_retired`, and finally deletes the changes files of removed records. Each step is
 * idempotent, so a retire that stopped part way finishes when it runs again.
 */
export async function retireConversation(input: {
  repositoryRoot: string;
  conversationId: string;
  checkout: ConversationCheckoutRemoval;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<ConversationRetirement> {
  await assertConversationRetirable(input.repositoryRoot, input.conversationId);
  if (!input.checkout.hostAbsent || !input.checkout.gitMetadataAbsent)
    fail("workspace_transition_conflict", "The conversation's checkout is not proven removed.");
  const { live } = await liveGenerations(input.repositoryRoot, input.conversationId);
  const cancelledAssignmentIds = await cancelConversationAssignments(input, live);
  const removedWorkspaceIds: string[] = [];
  for (const workspace of live) {
    await removeGeneration(input.repositoryRoot, workspace, input.checkout, input.now);
    removedWorkspaceIds.push(workspace.workspaceId);
  }
  const { workspaces } = await liveGenerations(input.repositoryRoot, input.conversationId);
  await pruneConversationChangedPaths(input.repositoryRoot, workspaces);
  return { cancelledAssignmentIds, removedWorkspaceIds };
}

/** Cancels the live generations' assignments that are not finished, each once. */
async function cancelConversationAssignments(
  input: { repositoryRoot: string; now?: Date; recordEvent?: WorkforceEventRecorder },
  live: readonly AgentWorkspace[],
): Promise<string[]> {
  const cancelled: string[] = [];
  for (const assignmentId of new Set(live.map((workspace) => workspace.assignmentId))) {
    const assignments = await listAssignments(input.repositoryRoot);
    const assignment = assignments.find((item) => item.assignmentId === assignmentId);
    if (
      assignment === undefined ||
      ["completed", "failed", "cancelled"].includes(assignment.status)
    )
      continue;
    const holder =
      assignment.lease === null
        ? undefined
        : { agentId: assignment.lease.agentId, leaseId: assignment.lease.leaseId };
    const now = input.now ?? new Date();
    const plan = createAssignmentCancellationPlan({
      assignments,
      assignmentId,
      reason: "requested",
      now,
      ...(holder === undefined ? {} : { holder }),
    });
    await cancelAssignment({
      repositoryRoot: input.repositoryRoot,
      assignmentId,
      reason: "requested",
      expectedPlanId: plan.planId,
      now,
      ...(holder === undefined ? {} : { holder }),
      ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    });
    cancelled.push(assignmentId);
  }
  return cancelled;
}

/** Moves one generation record to `recovery_required`, unless it is there, and then `removed`. */
async function removeGeneration(
  repositoryRoot: string,
  workspace: AgentWorkspace,
  checkout: ConversationCheckoutRemoval,
  now: Date | undefined,
): Promise<void> {
  let stored = await readWorkspace(repositoryRoot, workspace.workspaceId);
  if (stored === null || stored.workspace.state === "removed") return;
  const occurredAt = () => {
    const at = (now ?? new Date()).getTime();
    return new Date(Math.max(at, Date.parse(stored!.workspace.updatedAt))).toISOString();
  };
  if (stored.workspace.state !== "recovery_required")
    stored = await updateWorkspace({
      repositoryRoot,
      workspaceId: workspace.workspaceId,
      expectedContentHash: stored.contentHash,
      expectedRevision: stored.workspace.revision,
      expectedGeneration: stored.workspace.generation,
      nextState: "recovery_required",
      occurredAt: occurredAt(),
      recoveryReason: CONVERSATION_RETIRED,
      reasonCode: CONVERSATION_RETIRED,
      eventId: eventId(),
    });
  await updateWorkspace({
    repositoryRoot,
    workspaceId: workspace.workspaceId,
    expectedContentHash: stored.contentHash,
    expectedRevision: stored.workspace.revision,
    expectedGeneration: stored.workspace.generation,
    nextState: "removed",
    occurredAt: occurredAt(),
    evidence: { hostAbsent: checkout.hostAbsent, gitMetadataAbsent: checkout.gitMetadataAbsent },
    reasonCode: CONVERSATION_RETIRED,
    eventId: eventId(),
  });
}

function eventId(): string {
  return `evt_${randomUUID().replaceAll("-", "")}`;
}
