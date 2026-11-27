// One holder's refusals of a claim's paths (Lervo ADE coordination, "One denial per request"): a
// denial names the first group's holder, and the claim log keeps one entry per group.
import type { AssignmentPathRefusal } from "@lervo/agent-workforce";

/** Refusals grouped by code and holder, in order. */
export function refusalGroups(
  refusals: readonly AssignmentPathRefusal[],
): AssignmentPathRefusal[][] {
  const groups = new Map<string, AssignmentPathRefusal[]>();
  for (const refusal of refusals) {
    const key = [refusal.code, refusal.holderAgentId ?? "", refusal.holderWorkspaceId ?? ""].join(
      "\0",
    );
    groups.set(key, [...(groups.get(key) ?? []), refusal]);
  }
  return [...groups.values()];
}

/** A group's distinct paths, in order. */
export function groupPaths(group: readonly AssignmentPathRefusal[]): string[] {
  return [...new Set(group.map((refusal) => refusal.path))];
}

/**
 * The paths a group's holder holds over the group's paths, in order, or undefined when it holds
 * exactly the requested ones. A refusal without held paths holds its own path.
 */
export function groupHeldPaths(group: readonly AssignmentPathRefusal[]): string[] | undefined {
  if (group.every((refusal) => refusal.heldPaths === undefined)) return undefined;
  return [...new Set(group.flatMap((refusal) => refusal.heldPaths ?? [refusal.path]))];
}
