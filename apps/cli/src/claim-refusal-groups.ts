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
