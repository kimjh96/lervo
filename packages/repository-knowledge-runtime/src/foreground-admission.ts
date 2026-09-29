import type { WorkforceAssignment } from "@lervo/agent-workforce";

/** Scheduling evidence only: expiry does not settle an assignment or prove its effects stopped. */
export function hasCurrentForegroundLease(
  assignments: readonly WorkforceAssignment[],
  nowMilliseconds: number,
): boolean {
  return assignments.some((assignment) => {
    if (
      assignment.status !== "leased" ||
      assignment.convergence != null ||
      assignment.knowledgeJob != null
    )
      return false;
    const expiry = Date.parse(assignment.lease?.expiresAt ?? "");
    return !Number.isFinite(expiry) || expiry > nowMilliseconds;
  });
}
