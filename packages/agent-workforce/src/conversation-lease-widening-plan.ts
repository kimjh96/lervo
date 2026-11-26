import { CONVERSATION_WRITE_PATH_LIMIT } from "./assignment-path-bounds.js";
import {
  AssignmentPathHolders,
  judgeAssignmentPathConflicts,
  type AssignmentPathRefusal,
  type ChangedPathHolder,
} from "./assignment-path-conflict.js";
import { coalesceLeaseEntries } from "./conversation-lease-coalescing.js";
import { PathScopeIndex } from "./path-scope-index.js";
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

/**
 * The pure decision of one claim: which paths the lease gains and which are refused. Every scope is
 * indexed once, so the decision costs the paths times their depth, not paths times entries.
 */
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
  const held = PathScopeIndex.of(input.assignment.expectedPaths);
  const uncovered = input.paths.filter((path) => !held.covers(path));
  if (uncovered.length === 0) return { entries: null, claimedPaths: [], refusals: [] };
  const holderInput = {
    claimant: input.assignment,
    assignments: input.assignments,
    now: input.now,
    ...(input.changedPathHolders === undefined
      ? {}
      : { changedPathHolders: input.changedPathHolders }),
    ...(input.claimantWorkspaceId === undefined
      ? {}
      : { claimantWorkspaceId: input.claimantWorkspaceId }),
  };
  const holders = new AssignmentPathHolders(holderInput);
  const refusals = judgeAssignmentPathConflicts(
    { ...holderInput, paths: uncovered, responsibilityPaths: input.responsibilityPaths },
    holders,
  );
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
    limit: CONVERSATION_WRITE_PATH_LIMIT,
    isHeld: (path) => holders.overlaps(path),
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
