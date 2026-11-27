import { listAgents } from "./agent-registry.js";
import { assignmentAccessMode } from "./assignment-access-mode.js";
import { isConversationTaskType } from "./assignment-path-bounds.js";
import type { AssignmentPathRefusal, ChangedPathHolder } from "./assignment-path-conflict.js";
import { assignmentPath, listAssignments, readAssignmentState } from "./assignment-state.js";
import {
  leaseRenewedEvent,
  leaseWidenedEvent,
  type ConversationLeaseEvent,
  type ConversationLeaseEventRecorder,
} from "./conversation-lease-events.js";
import {
  pathLimitRefusals,
  planConversationLeaseWidening,
  type ConversationClaimMode,
} from "./conversation-lease-widening-plan.js";
import type { WorkforceAssignment } from "./types.js";
import { acquireLock, atomicWrite, workforceStateFits } from "./workforce-state-io.js";
import { fail, validAssignment } from "./workforce-state-validation.js";

/** A conversation lease runs 10 minutes from its last claim or renewal. */
export const CONVERSATION_LEASE_MS = 10 * 60_000;

/** A claim of held paths renews the lease once less than this remains. */
export const CONVERSATION_RENEWAL_THRESHOLD_MS = 5 * 60_000;

/**
 * A widened record leaves room below the 2 MiB state bound, so later completion, handoff, and
 * recovery writes of the same assignment still fit.
 */
export const MAXIMUM_WIDENED_ASSIGNMENT_BYTES = 1.5 * 1024 * 1024;

export interface ConversationClaimChunk {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  sessionId: string;
  /** Normalized, at most `MAXIMUM_CLAIM_PATHS_PER_CALL`. */
  paths: readonly string[];
  mode: ConversationClaimMode;
  claimantWorkspaceId?: string | null;
  changedPathHolders?: readonly ChangedPathHolder[];
  now: Date;
  recordEvent: ConversationLeaseEventRecorder;
  /** Aborted when the claim's answer went out without it; a chunk not yet locked stops. */
  signal?: AbortSignal;
  /** Runs immediately before the scheduler lock is taken; throwing takes no lock. */
  beforeLock?: () => void;
}

export interface ConversationClaimOutcome {
  /** `deferred` when the event failed and the bytes were restored. */
  status: "widened" | "covered" | "refused" | "deferred";
  assignment: WorkforceAssignment;
  addedPaths: string[];
  refusals: AssignmentPathRefusal[];
  leaseRenewed: boolean;
}

/** One scheduler lock hold: reread, judge, and widen or renew the lease for one chunk of paths. */
export async function claimConversationChunk(
  input: ConversationClaimChunk,
): Promise<ConversationClaimOutcome> {
  const target = await assignmentPath(input.repositoryRoot, input.assignmentId);
  input.signal?.throwIfAborted();
  input.beforeLock?.();
  const release = await acquireLock(target.lockPath, input.now);
  try {
    const { value: assignment, source: before } = await readAssignmentState(
      input.repositoryRoot,
      input.assignmentId,
    );
    assertConversationLeaseHolder(assignment, input);
    const agent = (await listAgents(input.repositoryRoot)).find(
      (item) => item.agentId === input.agentId,
    );
    if (agent === undefined || agent.status !== "active")
      fail("agent_state_conflict", "Only an active agent can widen its conversation lease.");
    const plan = planConversationLeaseWidening({
      assignment,
      paths: input.paths,
      mode: input.mode,
      responsibilityPaths: agent.responsibilityPaths,
      assignments: await listAssignments(input.repositoryRoot),
      now: input.now,
      ...(input.changedPathHolders === undefined
        ? {}
        : { changedPathHolders: input.changedPathHolders }),
      ...(input.claimantWorkspaceId === undefined
        ? {}
        : { claimantWorkspaceId: input.claimantWorkspaceId }),
    });
    const unchanged = { assignment, addedPaths: [], refusals: plan.refusals, leaseRenewed: false };
    if (plan.entries === null) {
      if (plan.refusals.length !== 0) return { ...unchanged, status: "refused" };
      const renewed = renewedAssignment(assignment, input.now);
      if (renewed === null) return { ...unchanged, status: "covered" };
      const committed = await commit(
        target.path,
        before,
        renewed,
        leaseRenewedEvent(renewed),
        input,
      );
      return committed
        ? { ...unchanged, assignment: renewed, status: "covered", leaseRenewed: true }
        : { ...unchanged, status: "deferred" };
    }
    const next = widenedAssignment(assignment, plan.entries, input.now);
    if (!workforceStateFits(serialized(next), MAXIMUM_WIDENED_ASSIGNMENT_BYTES))
      return {
        ...unchanged,
        status: "refused",
        refusals: [...plan.refusals, ...pathLimitRefusals(plan.claimedPaths)],
      };
    if (!validAssignment(next, assignment.projectId))
      fail("assignment_invalid", "The widened conversation assignment is invalid.");
    const cause = input.mode === "request" ? "claim" : "reconcile";
    const committed = await commit(
      target.path,
      before,
      next,
      leaseWidenedEvent(assignment, next, cause),
      input,
    );
    return committed
      ? { ...unchanged, status: "widened", assignment: next, addedPaths: plan.claimedPaths }
      : { ...unchanged, status: "deferred" };
  } finally {
    await release();
  }
}

function assertConversationLeaseHolder(
  assignment: WorkforceAssignment,
  input: ConversationClaimChunk,
): void {
  if (!isConversationTaskType(assignment.taskType) || assignmentAccessMode(assignment) !== "write")
    fail("assignment_invalid", "Only a writing conversation assignment widens its lease.");
  if (
    assignment.status !== "leased" ||
    assignment.lease === null ||
    assignment.lease.agentId !== input.agentId ||
    assignment.lease.sessionId !== input.sessionId ||
    Date.parse(assignment.lease.expiresAt) <= input.now.getTime()
  )
    fail(
      "assignment_lease_conflict",
      "The conversation lease is absent, expired, or held by another agent or session.",
    );
}

function serialized(assignment: WorkforceAssignment): string {
  return `${JSON.stringify(assignment, null, 2)}\n`;
}

/**
 * Writes the next record and records its event; a failed event restores the previous bytes, so the
 * transition never commits without it. Returns whether it committed.
 */
async function commit(
  path: string,
  before: string,
  next: WorkforceAssignment,
  event: ConversationLeaseEvent,
  input: ConversationClaimChunk,
): Promise<boolean> {
  await atomicWrite(path, serialized(next));
  try {
    await input.recordEvent(event);
    return true;
  } catch {
    await atomicWrite(path, before);
    return false;
  }
}

/** The lease moved to 10 minutes from now when less than 5 remain, or null when it has enough. */
function renewedAssignment(assignment: WorkforceAssignment, now: Date): WorkforceAssignment | null {
  const lease = assignment.lease!;
  if (Date.parse(lease.expiresAt) - now.getTime() >= CONVERSATION_RENEWAL_THRESHOLD_MS) return null;
  // A renewal keeps the revision, as `renewAssignmentLease` does, so a responsibility binding holds.
  return {
    ...assignment,
    lease: { ...lease, expiresAt: new Date(now.getTime() + CONVERSATION_LEASE_MS).toISOString() },
    updatedAt: now.toISOString(),
  };
}

function widenedAssignment(
  assignment: WorkforceAssignment,
  entries: string[],
  now: Date,
): WorkforceAssignment {
  const lease = assignment.lease!;
  // A renewal may already run past 10 minutes; a claim never shortens the lease.
  const expiresAt = Math.max(Date.parse(lease.expiresAt), now.getTime() + CONVERSATION_LEASE_MS);
  return {
    ...assignment,
    expectedPaths: entries,
    lease: { ...lease, expiresAt: new Date(expiresAt).toISOString() },
    revision: assignment.revision + 1,
    updatedAt: now.toISOString(),
  };
}
