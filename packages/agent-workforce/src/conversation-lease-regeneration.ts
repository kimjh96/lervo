import { randomUUID } from "node:crypto";

import { assignmentAccessMode } from "./assignment-access-mode.js";
import { nextAssignmentLeaseGeneration } from "./assignment-lease-generation.js";
import { isConversationTaskType } from "./assignment-path-bounds.js";
import {
  judgeAssignmentPathConflicts,
  type AssignmentPathHolderInput,
} from "./assignment-path-conflict.js";
import type { WorkforceAssignment } from "./types.js";
import { id } from "./workforce-state-validation.js";

/** Who claims under a conversation lease: the lead and its writer session. */
export interface ConversationLeaseClaimant {
  agentId: string;
  sessionId: string;
}

function writingConversation(assignment: WorkforceAssignment): boolean {
  return (
    isConversationTaskType(assignment.taskType) &&
    assignmentAccessMode(assignment) === "write" &&
    assignment.status === "leased" &&
    assignment.lease !== null
  );
}

/** Whether the claimant holds the conversation's live lease with its own writer session. */
export function conversationLeaseCurrent(
  assignment: WorkforceAssignment,
  claimant: ConversationLeaseClaimant,
  now: Date,
): boolean {
  return (
    writingConversation(assignment) &&
    assignment.lease!.agentId === claimant.agentId &&
    assignment.lease!.sessionId === claimant.sessionId &&
    Date.parse(assignment.lease!.expiresAt) > now.getTime()
  );
}

/**
 * Whether the lead comes back to its conversation's expired lease (Lervo ADE coordination, "Coming
 * back after expiry"). A live lease never regenerates: another session of the same lead claims
 * under the lease's own writer session instead, so two live sessions never trade the lease and
 * the generation advances at most once per expiry. Another agent's lease never regenerates.
 */
export function conversationLeaseRegenerable(
  assignment: WorkforceAssignment,
  claimant: ConversationLeaseClaimant,
  now: Date,
): boolean {
  return (
    writingConversation(assignment) &&
    assignment.lease!.agentId === claimant.agentId &&
    Date.parse(assignment.lease!.expiresAt) <= now.getTime()
  );
}

/**
 * The conversation assignment under the next lease generation, for the claimant's session, with
 * a 10-minute lease. It keeps every path of the stale lease that no other holder claimed
 * meanwhile and that the lead's responsibility still covers, judged against every holder at once,
 * so one path another holder took never fails the whole reacquisition.
 */
export function regenerateConversationLease(
  input: Omit<AssignmentPathHolderInput, "claimant"> & {
    assignment: WorkforceAssignment;
    claimant: ConversationLeaseClaimant;
    responsibilityPaths: readonly string[];
    leaseMs: number;
  },
): { assignment: WorkforceAssignment; droppedPaths: string[] } {
  const { assignment, now } = input;
  const refused = new Set(
    judgeAssignmentPathConflicts({
      ...input,
      claimant: assignment,
      paths: assignment.expectedPaths,
    }).map((refusal) => refusal.path),
  );
  const generation = nextAssignmentLeaseGeneration(assignment);
  return {
    assignment: {
      ...assignment,
      expectedPaths: assignment.expectedPaths.filter((path) => !refused.has(path)),
      lease: {
        leaseId: id("lse", {
          assignmentId: assignment.assignmentId,
          generation,
          nonce: randomUUID(),
        }),
        agentId: input.claimant.agentId,
        sessionId: input.claimant.sessionId,
        generation,
        acquiredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + input.leaseMs).toISOString(),
      },
      lastLeaseGeneration: generation,
      revision: assignment.revision + 1,
      updatedAt: now.toISOString(),
    },
    droppedPaths: assignment.expectedPaths.filter((path) => refused.has(path)),
  };
}
