import type { AssignmentPathRefusal } from "./assignment-path-conflict.js";
import {
  claimRefusedEvent,
  type ConversationLeaseEventRecorder,
} from "./conversation-lease-events.js";
import type { WorkforceAssignment } from "./types.js";

/** The most `assignment.claim.refused` events one call records; the rest are counted. */
export const MAXIMUM_REFUSAL_EVENTS_PER_CALL = 32;

/** A refusal the session's turn already recorded: its path and its holder's agent, if any. */
export interface RecordedClaimRefusal {
  readonly path: string;
  readonly holderAgentId: string | null;
}

export interface ConversationClaimRefusalRecording {
  /** The claiming conversation assignment; one without a lease records nothing. */
  assignment: WorkforceAssignment;
  refusals: readonly AssignmentPathRefusal[];
  detection: "tool" | "shell" | "reconcile";
  claimPathKey: Uint8Array;
  recordEvent: ConversationLeaseEventRecorder;
  now: Date;
  /**
   * Refusals already recorded in this session's turn. Lervo records at most one event per
   * session, holder, and path in a turn (Lervo ADE coordination, "Event schema 16").
   */
  recordedRefusals?: readonly RecordedClaimRefusal[];
}

export interface ConversationClaimRefusalRecordingResult {
  /** False when an event failed; the refusals stand regardless. */
  recorded: boolean;
  /** Refusals past the first 32 new ones, which recorded no event. */
  omitted: number;
}

function refusalKey(path: string, holderAgentId: string | null): string {
  return `${path}\0${holderAgentId ?? ""}`;
}

/**
 * Records one `assignment.claim.refused` per refusal the turn has not recorded yet, at most 32. A
 * refusal already stopped its write, so a failed event never turns it into an allowance: the result
 * reports it instead.
 */
export async function recordConversationClaimRefusals(
  input: ConversationClaimRefusalRecording,
): Promise<ConversationClaimRefusalRecordingResult> {
  if (input.assignment.lease === null) return { recorded: true, omitted: 0 };
  const seen = new Set(
    (input.recordedRefusals ?? []).map((item) => refusalKey(item.path, item.holderAgentId)),
  );
  const fresh = input.refusals.filter((refusal) => {
    const key = refusalKey(refusal.path, refusal.holderAgentId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const recording = fresh.slice(0, MAXIMUM_REFUSAL_EVENTS_PER_CALL);
  let recorded = true;
  for (const refusal of recording) {
    try {
      await input.recordEvent(
        claimRefusedEvent({
          assignment: input.assignment,
          refusal,
          detection: input.detection,
          claimPathKey: input.claimPathKey,
          occurredAt: input.now.toISOString(),
        }),
      );
    } catch {
      recorded = false;
    }
  }
  return { recorded, omitted: fresh.length - recording.length };
}

/**
 * `refusals` with each `path_leased` holder's conversation workspace filled in, when the holder's
 * assignment is a conversation's: the lease alone names no workspace.
 */
export function withLeaseHolderWorkspaces(
  refusals: readonly AssignmentPathRefusal[],
  leaseHolderWorkspaceIds: ReadonlyMap<string, string> | undefined,
): AssignmentPathRefusal[] {
  return refusals.map((refusal) => {
    const workspaceId =
      refusal.code === "path_leased" &&
      refusal.holderWorkspaceId === null &&
      refusal.holderAssignmentId !== null
        ? leaseHolderWorkspaceIds?.get(refusal.holderAssignmentId)
        : undefined;
    return workspaceId === undefined ? refusal : { ...refusal, holderWorkspaceId: workspaceId };
  });
}
