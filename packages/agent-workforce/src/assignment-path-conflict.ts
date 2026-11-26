import { repositoryPathScopesOverlap, repositoryPathWithinScope } from "@lervo/work-controller";
import { assignmentAccessMode } from "./assignment-access-mode.js";
import type { WorkforceAssignment } from "./types.js";

/** Why a claim of a path was refused (Lervo ADE coordination, "Conflicts"). */
export type AssignmentPathRefusalCode =
  | "path_leased"
  | "path_changed_unsealed"
  | "path_awaiting_integration"
  | "outside_responsibility"
  | "lease_path_limit";

export interface AssignmentPathRefusal {
  code: AssignmentPathRefusalCode;
  /** The claimed, repository-relative path. */
  path: string;
  holderAgentId: string | null;
  holderAssignmentId: string | null;
  holderWorkspaceId: string | null;
}

/**
 * A path that another conversation's workspace generation changed and has not integrated. The
 * workspace records own these; the workforce only judges them.
 */
export interface ChangedPathHolder {
  path: string;
  holderAgentId: string;
  holderWorkspaceId: string;
  holderAssignmentId?: string | null;
  code: "path_changed_unsealed" | "path_awaiting_integration";
}

export interface AssignmentPathConflictInput {
  /** The claiming assignment, which never conflicts with itself. */
  claimant: Pick<WorkforceAssignment, "assignmentId" | "accessMode">;
  paths: readonly string[];
  assignments: readonly WorkforceAssignment[];
  now: Date;
  /** When given, a path outside every scope is refused with `outside_responsibility`. */
  responsibilityPaths?: readonly string[];
  changedPathHolders?: readonly ChangedPathHolder[];
  /** The claimant's own conversation, whose changed paths never conflict with its claims. */
  claimantWorkspaceId?: string | null;
}

/** Another assignment's live write lease, the holder every claim judges against. */
export function liveWriteLeaseHolders(
  claimantAssignmentId: string,
  assignments: readonly WorkforceAssignment[],
  now: Date,
): WorkforceAssignment[] {
  return assignments.filter(
    (item) =>
      item.assignmentId !== claimantAssignmentId &&
      item.status === "leased" &&
      item.lease !== null &&
      Date.parse(item.lease.expiresAt) > now.getTime() &&
      assignmentAccessMode(item) === "write",
  );
}

/** Changed paths of other conversations: a conversation's own generations never conflict. */
export function foreignChangedPathHolders(
  holders: readonly ChangedPathHolder[],
  claimantWorkspaceId: string | null | undefined,
): ChangedPathHolder[] {
  return holders.filter(
    (holder) =>
      claimantWorkspaceId === undefined ||
      claimantWorkspaceId === null ||
      holder.holderWorkspaceId !== claimantWorkspaceId,
  );
}

/**
 * The one conflict judgment for every claim (ADR-0205 path exclusion): a conversation's claim, its
 * reconciliation, and `claimAssignment`. It returns each refusal, sorted by path and code; an empty
 * list means every path is claimable. A read-only claimant and read-only leases never conflict.
 */
export function judgeAssignmentPathConflicts(
  input: AssignmentPathConflictInput,
): AssignmentPathRefusal[] {
  const claimantWrites = assignmentAccessMode(input.claimant) === "write";
  const leases = claimantWrites
    ? liveWriteLeaseHolders(input.claimant.assignmentId, input.assignments, input.now)
    : [];
  const changed = claimantWrites
    ? foreignChangedPathHolders(input.changedPathHolders ?? [], input.claimantWorkspaceId)
    : [];
  const refusals: AssignmentPathRefusal[] = [];
  for (const path of input.paths) {
    if (
      input.responsibilityPaths !== undefined &&
      !input.responsibilityPaths.some((scope) => repositoryPathWithinScope(path, scope))
    )
      refusals.push(refusal("outside_responsibility", path, null, null, null));
    for (const lease of leases)
      if (lease.expectedPaths.some((held) => repositoryPathScopesOverlap(path, held)))
        refusals.push(refusal("path_leased", path, lease.lease!.agentId, lease.assignmentId, null));
    for (const holder of changed)
      if (repositoryPathScopesOverlap(path, holder.path))
        refusals.push(
          refusal(
            holder.code,
            path,
            holder.holderAgentId,
            holder.holderAssignmentId ?? null,
            holder.holderWorkspaceId,
          ),
        );
  }
  return dedupeRefusals(refusals);
}

function refusal(
  code: AssignmentPathRefusalCode,
  path: string,
  holderAgentId: string | null,
  holderAssignmentId: string | null,
  holderWorkspaceId: string | null,
): AssignmentPathRefusal {
  return { code, path, holderAgentId, holderAssignmentId, holderWorkspaceId };
}

/** One refusal per path, code, and holder, in path order. */
function dedupeRefusals(refusals: readonly AssignmentPathRefusal[]): AssignmentPathRefusal[] {
  const unique = new Map<string, AssignmentPathRefusal>();
  for (const item of refusals) unique.set(refusalKey(item).join("\0"), item);
  return [...unique.values()].sort((left, right) => {
    const a = refusalKey(left);
    const b = refusalKey(right);
    const index = a.findIndex((value, position) => value !== b[position]);
    return index === -1 ? 0 : a[index]! < b[index]! ? -1 : 1;
  });
}

function refusalKey(item: AssignmentPathRefusal): string[] {
  return [
    item.path,
    item.code,
    item.holderAgentId ?? "",
    item.holderAssignmentId ?? "",
    item.holderWorkspaceId ?? "",
  ];
}
