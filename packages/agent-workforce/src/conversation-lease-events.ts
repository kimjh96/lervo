import type {
  AssignmentClaimRefusedEventPayload,
  AssignmentLeaseWidenedEventPayload,
} from "@lervo/schemas";
import type { AssignmentPathRefusal } from "./assignment-path-conflict.js";
import { claimPathDigest } from "./claim-path-digest.js";
import type { WorkforceAssignment } from "./types.js";
import { digest, stableJson } from "./workforce-state-validation.js";

/**
 * Event schema 16's coordination events (Lervo ADE coordination), and the existing renewal a claim
 * makes when its lease runs low. They are kept apart from `WorkforceEvent`, whose recorders write
 * schema 1 envelopes: a recorder of these writes a schema 16 envelope, and a writer below 16 never
 * widens a lease.
 */
export type ConversationLeaseEvent =
  | {
      type: "assignment.lease.renewed";
      occurredAt: string;
      actorAgentId: string;
      payload: {
        assignmentId: string;
        agentId: string;
        leaseId: string;
        generation: number;
        expiresAt: string;
      };
    }
  | {
      type: "assignment.lease.widened";
      occurredAt: string;
      actorAgentId: string;
      payload: AssignmentLeaseWidenedEventPayload;
    }
  | {
      type: "assignment.claim.refused";
      occurredAt: string;
      actorAgentId: string;
      payload: AssignmentClaimRefusedEventPayload;
    };

export type ConversationLeaseEventRecorder = (
  event: ConversationLeaseEvent,
) => void | Promise<void>;

/** `assignment.lease.renewed`, unchanged: a claim of held paths moved the expiry only. */
export function leaseRenewedEvent(next: WorkforceAssignment): ConversationLeaseEvent {
  const lease = next.lease!;
  return {
    type: "assignment.lease.renewed",
    occurredAt: next.updatedAt,
    actorAgentId: lease.agentId,
    payload: {
      assignmentId: next.assignmentId,
      agentId: lease.agentId,
      leaseId: lease.leaseId,
      generation: lease.generation,
      expiresAt: lease.expiresAt,
    },
  };
}

/** One growth of the lease: counts and the digest of the sorted path set, never a path. */
export function leaseWidenedEvent(
  previous: WorkforceAssignment,
  next: WorkforceAssignment,
  cause: "claim" | "reconcile",
): ConversationLeaseEvent {
  const held = new Set(previous.expectedPaths);
  const agentId = next.lease!.agentId;
  return {
    type: "assignment.lease.widened",
    occurredAt: next.updatedAt,
    actorAgentId: agentId,
    payload: {
      assignmentId: next.assignmentId,
      agentId,
      leaseGeneration: next.lease!.generation,
      revision: next.revision,
      expectedPathDigest: digest(stableJson(next.expectedPaths)),
      expectedPathCount: next.expectedPaths.length,
      addedPathCount: next.expectedPaths.filter((path) => !held.has(path)).length,
      cause,
      occurredAt: next.updatedAt,
    },
  };
}

/** One refused claim of one path and holder; the path appears only as its keyed digest. */
export function claimRefusedEvent(input: {
  assignment: WorkforceAssignment;
  refusal: AssignmentPathRefusal;
  detection: "tool" | "shell" | "reconcile";
  claimPathKey: Uint8Array;
  occurredAt: string;
}): ConversationLeaseEvent {
  const agentId = input.assignment.lease!.agentId;
  return {
    type: "assignment.claim.refused",
    occurredAt: input.occurredAt,
    actorAgentId: agentId,
    payload: {
      assignmentId: input.assignment.assignmentId,
      agentId,
      leaseGeneration: input.assignment.lease!.generation,
      code: input.refusal.code,
      holderAgentId: input.refusal.holderAgentId,
      holderAssignmentId: input.refusal.holderAssignmentId,
      holderWorkspaceId: input.refusal.holderWorkspaceId,
      pathDigest: claimPathDigest(input.claimPathKey, input.refusal.path),
      detection: input.detection,
      occurredAt: input.occurredAt,
    },
  };
}
