import { assignmentAccessMode } from "./assignment-access-mode.js";
import { PathScopeIndex } from "./path-scope-index.js";
import type { WorkforceAssignment } from "./types.js";

/**
 * Why a claim of a path was refused (Lervo ADE coordination, "Conflicts"). The judgment never
 * returns `path_outside_workspace`: the claim handler refuses a target in another checkout before
 * it asks.
 */
export type AssignmentPathRefusalCode =
  | "path_leased"
  | "path_changed_unsealed"
  | "path_awaiting_integration"
  | "outside_responsibility"
  | "path_outside_workspace"
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

export interface AssignmentPathHolderInput {
  /** The claiming assignment, which never conflicts with itself. */
  claimant: Pick<WorkforceAssignment, "assignmentId" | "accessMode">;
  assignments: readonly WorkforceAssignment[];
  now: Date;
  changedPathHolders?: readonly ChangedPathHolder[];
  /** The claimant's own conversation, whose changed paths never conflict with its claims. */
  claimantWorkspaceId?: string | null;
}

export interface AssignmentPathConflictInput extends AssignmentPathHolderInput {
  paths: readonly string[];
  /** When given, a path outside every scope is refused with `outside_responsibility`. */
  responsibilityPaths?: readonly string[];
}

/**
 * Every holder a claim is judged against, indexed once: other assignments' live write leases and
 * other conversations' changed paths. A read-only claimant and read-only leases hold nothing.
 */
export class AssignmentPathHolders {
  readonly #leases = new PathScopeIndex<WorkforceAssignment>();
  readonly #changed = new PathScopeIndex<ChangedPathHolder>();

  constructor(input: AssignmentPathHolderInput) {
    if (assignmentAccessMode(input.claimant) !== "write") return;
    const now = input.now.getTime();
    for (const item of input.assignments)
      if (
        item.assignmentId !== input.claimant.assignmentId &&
        item.status === "leased" &&
        item.lease !== null &&
        Date.parse(item.lease.expiresAt) > now &&
        assignmentAccessMode(item) === "write"
      )
        for (const path of item.expectedPaths) this.#leases.add(path, item);
    for (const holder of input.changedPathHolders ?? [])
      if (
        holder.holderAssignmentId !== input.claimant.assignmentId &&
        (input.claimantWorkspaceId == null ||
          holder.holderWorkspaceId !== input.claimantWorkspaceId)
      )
        this.#changed.add(holder.path, holder);
  }

  overlaps(path: string): boolean {
    return this.#leases.overlaps(path) || this.#changed.overlaps(path);
  }

  refusals(path: string): AssignmentPathRefusal[] {
    return [
      ...this.#leases
        .overlapping(path)
        .map((lease) =>
          refusal("path_leased", path, lease.lease!.agentId, lease.assignmentId, null),
        ),
      ...this.#changed
        .overlapping(path)
        .map((holder) =>
          refusal(
            holder.code,
            path,
            holder.holderAgentId,
            holder.holderAssignmentId ?? null,
            holder.holderWorkspaceId,
          ),
        ),
    ];
  }
}

/**
 * The one conflict judgment for every claim (ADR-0205 path exclusion): a conversation's claim, its
 * reconciliation, and `claimAssignment`. It returns each refusal once per path, code, and holder,
 * sorted; an empty list means every path is claimable.
 */
export function judgeAssignmentPathConflicts(
  input: AssignmentPathConflictInput,
  holders: AssignmentPathHolders = new AssignmentPathHolders(input),
): AssignmentPathRefusal[] {
  const responsibility =
    input.responsibilityPaths === undefined ? null : PathScopeIndex.of(input.responsibilityPaths);
  const refusals: AssignmentPathRefusal[] = [];
  for (const path of input.paths) {
    if (responsibility !== null && !responsibility.covers(path))
      refusals.push(refusal("outside_responsibility", path, null, null, null));
    refusals.push(...holders.refusals(path));
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

/** One refusal per path, code, and holder, in that order. */
function dedupeRefusals(refusals: readonly AssignmentPathRefusal[]): AssignmentPathRefusal[] {
  const unique = new Map<string, { key: string[]; refusal: AssignmentPathRefusal }>();
  for (const item of refusals) {
    const key = [
      item.path,
      item.code,
      item.holderAgentId ?? "",
      item.holderAssignmentId ?? "",
      item.holderWorkspaceId ?? "",
    ];
    unique.set(key.join("\0"), { key, refusal: item });
  }
  return [...unique.values()]
    .sort((left, right) => {
      const index = left.key.findIndex((value, position) => value !== right.key[position]);
      return index === -1 ? 0 : left.key[index]! < right.key[index]! ? -1 : 1;
    })
    .map((item) => item.refusal);
}
