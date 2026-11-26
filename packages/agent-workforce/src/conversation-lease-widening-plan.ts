import { repositoryPathWithinScope } from "@lervo/work-controller";
import { MAXIMUM_CONVERSATION_EXPECTED_PATHS } from "./assignment-path-bounds.js";
import {
  foreignChangedPathHolders,
  judgeAssignmentPathConflicts,
  liveWriteLeaseHolders,
  type AssignmentPathRefusal,
  type ChangedPathHolder,
} from "./assignment-path-conflict.js";
import { coalesceLeaseEntries } from "./conversation-lease-coalescing.js";
import type { WorkforceAssignment } from "./types.js";

/**
 * `request`: one hook request's targets, claimed all or none. `reconcile`: the paths a turn's end
 * found changed, of which the conflict-free part is claimed.
 */
export type ConversationClaimMode = "request" | "reconcile";

export interface ConversationLeaseWideningPlan {
  /** The lease's path set after widening, or null when nothing is added. */
  entries: string[] | null;
  /** The requested paths this widening claims. */
  claimedPaths: string[];
  refusals: AssignmentPathRefusal[];
}

/** The pure decision of one claim: which paths the lease gains and which are refused. */
export function planConversationLeaseWidening(input: {
  assignment: WorkforceAssignment;
  paths: readonly string[];
  mode: ConversationClaimMode;
  responsibilityPaths: readonly string[];
  assignments: readonly WorkforceAssignment[];
  now: Date;
  changedPathHolders?: readonly ChangedPathHolder[];
  claimantWorkspaceId?: string | null;
}): ConversationLeaseWideningPlan {
  const uncovered = input.paths.filter(
    (path) =>
      !input.assignment.expectedPaths.some((entry) => repositoryPathWithinScope(path, entry)),
  );
  if (uncovered.length === 0) return { entries: null, claimedPaths: [], refusals: [] };
  const changedPathHolders = foreignChangedPathHolders(
    input.changedPathHolders ?? [],
    input.claimantWorkspaceId,
  );
  const refusals = judgeAssignmentPathConflicts({
    claimant: input.assignment,
    paths: uncovered,
    assignments: input.assignments,
    now: input.now,
    responsibilityPaths: input.responsibilityPaths,
    changedPathHolders,
  });
  const refused = new Set(refusals.map((item) => item.path));
  const claimable =
    input.mode === "request"
      ? refused.size === 0
        ? uncovered
        : []
      : uncovered.filter((path) => !refused.has(path));
  if (claimable.length === 0) return { entries: null, claimedPaths: [], refusals };
  const entries = coalesceLeaseEntries({
    entries: [...input.assignment.expectedPaths, ...claimable],
    limit: MAXIMUM_CONVERSATION_EXPECTED_PATHS,
    heldPaths: [
      ...liveWriteLeaseHolders(input.assignment.assignmentId, input.assignments, input.now).flatMap(
        (holder) => holder.expectedPaths,
      ),
      ...changedPathHolders.map((holder) => holder.path),
    ],
    responsibilityPaths: input.responsibilityPaths,
  });
  if (entries === null)
    return {
      entries: null,
      claimedPaths: [],
      refusals: [...refusals, ...pathLimitRefusals(claimable)],
    };
  return { entries, claimedPaths: claimable, refusals };
}

export function pathLimitRefusals(paths: readonly string[]): AssignmentPathRefusal[] {
  return paths.map((path) => ({
    code: "lease_path_limit",
    path,
    holderAgentId: null,
    holderAssignmentId: null,
    holderWorkspaceId: null,
  }));
}
