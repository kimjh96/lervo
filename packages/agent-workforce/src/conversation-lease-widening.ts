import { MAXIMUM_CLAIM_PATHS_PER_CALL } from "./assignment-path-bounds.js";
import type { AssignmentPathRefusal, ChangedPathHolder } from "./assignment-path-conflict.js";
import { MINIMUM_CLAIM_PATH_KEY_BYTES } from "./claim-path-digest.js";
import {
  normalizeClaimPaths,
  validChangedPathHolder,
  validClaimantWorkspaceId,
} from "./conversation-claim-input.js";
import {
  claimConversationChunk,
  type ConversationClaimOutcome,
} from "./conversation-lease-claim-transition.js";
import {
  claimRefusedEvent,
  type ConversationLeaseEventRecorder,
} from "./conversation-lease-events.js";
import type { ConversationClaimMode } from "./conversation-lease-widening-plan.js";
import type { WorkforceAssignment } from "./types.js";
import { retryConcurrent } from "./workforce-state-io.js";
import { AGENT_ID, fail, SESSION_ID } from "./workforce-state-validation.js";

/** The most `assignment.claim.refused` events one call records; the rest are counted. */
export const MAXIMUM_REFUSAL_EVENTS_PER_CALL = 32;

export interface WidenConversationLeaseInput {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  sessionId: string;
  /** At most 2,000 for a request; a reconciliation of up to 10,000 runs in chunks of 2,000. */
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
  /** Writes schema 16 envelopes; a widening or renewal does not commit without its event. */
  recordEvent: ConversationLeaseEventRecorder;
}

export interface WidenConversationLeaseResult {
  /**
   * `covered` when the lease already held every path; `deferred` when a widening or renewal event
   * failed, its bytes were restored, and later chunks did not run. Refusals stand in every status.
   */
  status: "widened" | "covered" | "refused" | "deferred";
  assignment: WorkforceAssignment;
  /** The requested paths this call claimed, normalized. */
  addedPaths: string[];
  refusals: AssignmentPathRefusal[];
  /** Whether a claim of held paths renewed a lease with less than 5 minutes left. */
  leaseRenewed: boolean;
  /** False when an `assignment.claim.refused` event failed; the refusals stand regardless. */
  refusalsRecorded: boolean;
  /** Refusals past the first 32, which recorded no event. */
  omittedRefusalEvents: number;
}

/**
 * Widens a conversation assignment's live lease by claims (Lervo ADE coordination, "How a claim
 * widens the lease"). A `request` claims its paths all or none in one scheduler lock hold;
 * `reconcile` claims the conflict-free part, 2,000 paths per lock hold. The lease generation stays;
 * the expiry moves to 10 minutes from now and the revision advances.
 */
export async function widenConversationLease(
  input: WidenConversationLeaseInput,
): Promise<WidenConversationLeaseResult> {
  const paths = validatedPaths(input);
  const now = input.now ?? new Date();
  const outcomes: ConversationClaimOutcome[] = [];
  for (let start = 0; start < paths.length; start += MAXIMUM_CLAIM_PATHS_PER_CALL) {
    const chunk = {
      repositoryRoot: input.repositoryRoot,
      assignmentId: input.assignmentId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      paths: paths.slice(start, start + MAXIMUM_CLAIM_PATHS_PER_CALL),
      mode: input.mode,
      now,
      recordEvent: input.recordEvent,
      ...(input.claimantWorkspaceId === undefined
        ? {}
        : { claimantWorkspaceId: input.claimantWorkspaceId }),
      ...(input.changedPathHolders === undefined
        ? {}
        : { changedPathHolders: input.changedPathHolders }),
    };
    // Every input is reread under the lock, so only a busy lock is worth another attempt.
    const outcome = await retryConcurrent(() => claimConversationChunk(chunk), ["workforce_busy"]);
    outcomes.push(outcome);
    if (outcome.status === "deferred") break;
  }
  const result = combinedOutcome(outcomes);
  const recorded = result.refusals.slice(0, MAXIMUM_REFUSAL_EVENTS_PER_CALL);
  return {
    ...result,
    refusalsRecorded: await recordRefusals(input, result.assignment, recorded, now),
    omittedRefusalEvents: result.refusals.length - recorded.length,
  };
}

function validatedPaths(input: WidenConversationLeaseInput): string[] {
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
  const paths = normalizeClaimPaths(input.paths);
  if (paths === null)
    fail("assignment_invalid", "A claimed path is not a normalized repository-relative path.");
  if (input.mode === "request" && paths.length > MAXIMUM_CLAIM_PATHS_PER_CALL)
    fail("assignment_invalid", "A claim request names more than 2,000 paths.");
  return paths;
}

function combinedOutcome(
  outcomes: readonly ConversationClaimOutcome[],
): Omit<WidenConversationLeaseResult, "refusalsRecorded" | "omittedRefusalEvents"> {
  const addedPaths = outcomes.flatMap((outcome) => outcome.addedPaths);
  const refusals = outcomes.flatMap((outcome) => outcome.refusals);
  const status = outcomes.some((outcome) => outcome.status === "deferred")
    ? "deferred"
    : addedPaths.length !== 0
      ? "widened"
      : refusals.length !== 0
        ? "refused"
        : "covered";
  return {
    status,
    assignment: structuredClone(outcomes.at(-1)!.assignment),
    addedPaths,
    refusals,
    leaseRenewed: outcomes.some((outcome) => outcome.leaseRenewed),
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
  now: Date,
): Promise<boolean> {
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
          occurredAt: now.toISOString(),
        }),
      );
    } catch {
      recorded = false;
    }
  }
  return recorded;
}
