import { MAXIMUM_CLAIM_PATHS_PER_CALL } from "./assignment-path-bounds.js";
import type { AssignmentPathRefusal, ChangedPathHolder } from "./assignment-path-conflict.js";
import { MINIMUM_CLAIM_PATH_KEY_BYTES } from "./claim-path-digest.js";
import {
  normalizeClaimPaths,
  validChangedPathHolder,
  validClaimantWorkspaceId,
  validLeaseHolderWorkspaceIds,
  validRecordedRefusals,
} from "./conversation-claim-input.js";
import {
  recordConversationClaimRefusals,
  withLeaseHolderWorkspaces,
  type RecordedClaimRefusal,
} from "./conversation-claim-refusals.js";
import {
  claimConversationChunk,
  type ConversationClaimOutcome,
} from "./conversation-lease-claim-transition.js";
import type { ConversationLeaseEventRecorder } from "./conversation-lease-events.js";
import type { ConversationClaimMode } from "./conversation-lease-widening-plan.js";
import type { WorkforceAssignment } from "./types.js";
import { retryConcurrent } from "./workforce-state-io.js";
import { AGENT_ID, fail, SESSION_ID } from "./workforce-state-validation.js";

export interface WidenConversationLeaseInput {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  sessionId: string;
  /**
   * At most 2,000 for a request; a reconciliation of up to 10,000 runs in chunks of 2,000. A
   * reconciliation that found nothing changed names none and only renews the lease when it runs low.
   */
  paths: readonly string[];
  mode: ConversationClaimMode;
  /** How a request found its paths: a file tool's input or a command's targets. */
  detection?: "tool" | "shell";
  /** The conversation's own workspace, whose changed paths never conflict with its claims. */
  claimantWorkspaceId?: string | null;
  /** Other conversations' changed and sealed paths, judged as holders. */
  changedPathHolders?: readonly ChangedPathHolder[];
  /**
   * Each other conversation assignment's workspace, keyed by assignment ID, so a `path_leased`
   * refusal and its event name where the holder works. A lease alone names no workspace.
   */
  leaseHolderWorkspaceIds?: ReadonlyMap<string, string>;
  /** Refusals this session's turn already recorded; none of them records an event again. */
  recordedRefusals?: readonly RecordedClaimRefusal[];
  /**
   * Aborted when the hook answered without this claim, so the write went ahead. A chunk that has
   * not taken the scheduler lock stops, and no refusal records its event.
   */
  signal?: AbortSignal;
  /**
   * Runs immediately before each chunk takes the scheduler lock. Throwing stops the widening
   * there, so a caller can check its remaining time at the last moment.
   */
  beforeLock?: () => void;
  /**
   * Reacquires the lease under the next generation when it is the lead's but expired, keeping the
   * paths no other holder took meanwhile.
   */
  regenerate?: boolean;
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
  /** Whether the lease was reacquired under the next generation first. */
  leaseRegenerated: boolean;
  /** The stale lease's paths that the reacquisition gave up to other holders. */
  droppedPaths: string[];
  /** False when an `assignment.claim.refused` event failed; the refusals stand regardless. */
  refusalsRecorded: boolean;
  /** New refusals past the first 32, which recorded no event. */
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
  // A reconciliation without paths still runs one chunk, which renews or regenerates the lease.
  for (let start = 0; start === 0 || start < paths.length; start += MAXIMUM_CLAIM_PATHS_PER_CALL) {
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
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.beforeLock === undefined ? {} : { beforeLock: input.beforeLock }),
      ...(input.regenerate === undefined ? {} : { regenerate: input.regenerate }),
    };
    // Every input is reread under the lock, so only a busy lock is worth another attempt.
    const outcome = await retryConcurrent(() => claimConversationChunk(chunk), ["workforce_busy"]);
    outcomes.push(outcome);
    if (outcome.status === "deferred") break;
  }
  const combined = combinedOutcome(outcomes);
  const result = {
    ...combined,
    refusals: withLeaseHolderWorkspaces(combined.refusals, input.leaseHolderWorkspaceIds),
  };
  const recording = await recordConversationClaimRefusals({
    assignment: result.assignment,
    refusals: result.refusals,
    detection: input.mode === "reconcile" ? "reconcile" : input.detection!,
    claimPathKey: input.claimPathKey,
    recordEvent: input.recordEvent,
    now,
    ...(input.recordedRefusals === undefined ? {} : { recordedRefusals: input.recordedRefusals }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  return {
    ...result,
    refusalsRecorded: recording.recorded,
    omittedRefusalEvents: recording.omitted,
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
    !validLeaseHolderWorkspaceIds(input.leaseHolderWorkspaceIds) ||
    !validRecordedRefusals(input.recordedRefusals) ||
    !(input.signal === undefined || input.signal instanceof AbortSignal) ||
    !(input.beforeLock === undefined || typeof input.beforeLock === "function") ||
    !(input.regenerate === undefined || typeof input.regenerate === "boolean") ||
    !(input.claimPathKey instanceof Uint8Array) ||
    input.claimPathKey.byteLength < MINIMUM_CLAIM_PATH_KEY_BYTES ||
    typeof input.recordEvent !== "function"
  )
    fail("assignment_invalid", "The conversation claim coordinates are invalid.");
  const paths =
    input.mode === "reconcile" && Array.isArray(input.paths) && input.paths.length === 0
      ? []
      : normalizeClaimPaths(input.paths);
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
    leaseRegenerated: outcomes.some((outcome) => outcome.leaseRegenerated),
    droppedPaths: outcomes.flatMap((outcome) => outcome.droppedPaths),
  };
}
