import { listAgents } from "./agent-registry.js";
import { assignmentAccessMode } from "./assignment-access-mode.js";
import { isConversationTaskType } from "./assignment-path-bounds.js";
import type { AssignmentPathRefusal, ChangedPathHolder } from "./assignment-path-conflict.js";
import { assignmentPath, listAssignments, readAssignmentState } from "./assignment-state.js";
import { MINIMUM_CLAIM_PATH_KEY_BYTES } from "./claim-path-digest.js";
import {
  normalizeClaimPaths,
  validChangedPathHolder,
  validClaimantWorkspaceId,
} from "./conversation-claim-input.js";
import {
  claimRefusedEvent,
  leaseWidenedEvent,
  type ConversationLeaseEventRecorder,
} from "./conversation-lease-events.js";
import {
  pathLimitRefusals,
  planConversationLeaseWidening,
  type ConversationClaimMode,
} from "./conversation-lease-widening-plan.js";
import type { WorkforceAssignment } from "./types.js";
import { acquireLock, atomicWrite, retryConcurrent } from "./workforce-state-io.js";
import {
  AGENT_ID,
  fail,
  MAXIMUM_STATE_BYTES,
  SESSION_ID,
  validAssignment,
} from "./workforce-state-validation.js";

/** A conversation lease runs 10 minutes from its last claim or renewal. */
export const CONVERSATION_LEASE_MS = 10 * 60_000;

export interface WidenConversationLeaseInput {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  sessionId: string;
  paths: readonly string[];
  mode: ConversationClaimMode;
  /** How a request found its paths: a file tool's input or a command's targets. */
  detection?: "tool" | "shell";
  /** The conversation's own workspace, whose changed paths never conflict with its claims. */
  claimantWorkspaceId?: string | null;
  /** Other conversations' changed and sealed paths, judged as holders. */
  changedPathHolders?: readonly ChangedPathHolder[];
  /** The repository instance's local secret for `assignment.claim.refused`'s `pathDigest`. */
  claimPathKey: Uint8Array;
  now?: Date;
  /** Writes schema 16 envelopes; the widening does not commit without its event. */
  recordEvent: ConversationLeaseEventRecorder;
}

export interface WidenConversationLeaseResult {
  /** `covered` when the lease already held every path, so nothing changed. */
  status: "widened" | "covered" | "refused";
  assignment: WorkforceAssignment;
  /** The requested paths this widening claimed, normalized. */
  addedPaths: string[];
  refusals: AssignmentPathRefusal[];
  /** False when an `assignment.claim.refused` event failed; the refusals stand regardless. */
  refusalsRecorded: boolean;
}

/**
 * Widens a conversation assignment's live lease by claims (Lervo ADE coordination, "How a claim
 * widens the lease"), under the scheduler lock every assignment transition takes. A `request`
 * claims its paths all or none; `reconcile` claims the conflict-free part. The lease generation
 * stays; the expiry moves to 10 minutes from now and the revision advances. The widening commits
 * only with `assignment.lease.widened`; each refusal records `assignment.claim.refused`.
 */
export async function widenConversationLease(
  input: WidenConversationLeaseInput,
): Promise<WidenConversationLeaseResult> {
  assertWideningInput(input);
  const outcome = await retryConcurrent(() => widenConversationLeaseOnce(input));
  const refusalsRecorded = await recordRefusals(input, outcome.assignment, outcome.refusals);
  return { ...outcome, refusalsRecorded };
}

function assertWideningInput(input: WidenConversationLeaseInput): void {
  if (
    !AGENT_ID.test(input.agentId) ||
    !SESSION_ID.test(input.sessionId) ||
    !(
      (input.mode === "request" && (input.detection === "tool" || input.detection === "shell")) ||
      (input.mode === "reconcile" && input.detection === undefined)
    ) ||
    !validClaimantWorkspaceId(input.claimantWorkspaceId) ||
    !(input.changedPathHolders ?? []).every(validChangedPathHolder) ||
    !(input.claimPathKey instanceof Uint8Array) ||
    input.claimPathKey.byteLength < MINIMUM_CLAIM_PATH_KEY_BYTES ||
    typeof input.recordEvent !== "function"
  )
    fail("assignment_invalid", "The conversation claim coordinates are invalid.");
  if (normalizeClaimPaths(input.paths) === null)
    fail("assignment_invalid", "A claimed path is not a normalized repository-relative path.");
}

async function widenConversationLeaseOnce(
  input: WidenConversationLeaseInput,
): Promise<Omit<WidenConversationLeaseResult, "refusalsRecorded">> {
  const now = input.now ?? new Date();
  const paths = normalizeClaimPaths(input.paths)!;
  const target = await assignmentPath(input.repositoryRoot, input.assignmentId);
  const release = await acquireLock(target.lockPath, now);
  try {
    const { value: assignment, source: before } = await readAssignmentState(
      input.repositoryRoot,
      input.assignmentId,
    );
    assertConversationLeaseHolder(assignment, input, now);
    const agent = (await listAgents(input.repositoryRoot)).find(
      (item) => item.agentId === input.agentId,
    );
    if (agent === undefined || agent.status !== "active")
      fail("agent_state_conflict", "Only an active agent can widen its conversation lease.");
    const plan = planConversationLeaseWidening({
      assignment,
      paths,
      mode: input.mode,
      responsibilityPaths: agent.responsibilityPaths,
      assignments: await listAssignments(input.repositoryRoot),
      now,
      ...(input.changedPathHolders === undefined
        ? {}
        : { changedPathHolders: input.changedPathHolders }),
      ...(input.claimantWorkspaceId === undefined
        ? {}
        : { claimantWorkspaceId: input.claimantWorkspaceId }),
    });
    const unchanged = { assignment: structuredClone(assignment), addedPaths: [] };
    if (plan.entries === null)
      return {
        ...unchanged,
        status: plan.refusals.length === 0 ? "covered" : "refused",
        refusals: plan.refusals,
      };
    const next = widenedAssignment(assignment, plan.entries, now);
    const content = `${JSON.stringify(next, null, 2)}\n`;
    if (Buffer.byteLength(content) > MAXIMUM_STATE_BYTES)
      return {
        ...unchanged,
        status: "refused",
        refusals: [...plan.refusals, ...pathLimitRefusals(plan.claimedPaths)],
      };
    if (!validAssignment(next, assignment.projectId))
      fail("assignment_invalid", "The widened conversation assignment is invalid.");
    await atomicWrite(target.path, content);
    try {
      await input.recordEvent(
        leaseWidenedEvent(assignment, next, input.mode === "request" ? "claim" : "reconcile"),
      );
    } catch (error) {
      await atomicWrite(target.path, before);
      fail(
        "workforce_write_failed",
        "The lease widening event failed and state was restored.",
        error,
      );
    }
    return {
      status: "widened",
      assignment: structuredClone(next),
      addedPaths: plan.claimedPaths,
      refusals: plan.refusals,
    };
  } finally {
    await release();
  }
}

function assertConversationLeaseHolder(
  assignment: WorkforceAssignment,
  input: WidenConversationLeaseInput,
  now: Date,
): void {
  if (!isConversationTaskType(assignment.taskType) || assignmentAccessMode(assignment) !== "write")
    fail("assignment_invalid", "Only a writing conversation assignment widens its lease.");
  if (
    assignment.status !== "leased" ||
    assignment.lease === null ||
    assignment.lease.agentId !== input.agentId ||
    assignment.lease.sessionId !== input.sessionId ||
    Date.parse(assignment.lease.expiresAt) <= now.getTime()
  )
    fail(
      "assignment_lease_conflict",
      "The conversation lease is absent, expired, or held by another agent or session.",
    );
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

/**
 * Records one `assignment.claim.refused` per refusal. A refusal already stopped its write, so a
 * failed event never turns it into an allowance; it reports `false` instead.
 */
async function recordRefusals(
  input: WidenConversationLeaseInput,
  assignment: WorkforceAssignment,
  refusals: readonly AssignmentPathRefusal[],
): Promise<boolean> {
  const occurredAt = (input.now ?? new Date()).toISOString();
  const detection = input.mode === "reconcile" ? "reconcile" : input.detection!;
  let recorded = true;
  for (const refusal of refusals) {
    try {
      await input.recordEvent(
        claimRefusedEvent({
          assignment,
          refusal,
          detection,
          claimPathKey: input.claimPathKey,
          occurredAt,
        }),
      );
    } catch {
      recorded = false;
    }
  }
  return recorded;
}
