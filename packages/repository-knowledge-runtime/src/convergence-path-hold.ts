import { listAssignments, readAssignmentClaimRefusals } from "@lervo/agent-workforce";

/** The stage a convergence failure record names, when it names one. */
export interface ConvergencePathConflictDependency {
  obligationId?: string;
  stage?: string;
}

const FINISHED = new Set(["completed", "failed", "cancelled"]);

/**
 * Whether a convergence stage that a claim refused with `assignment_path_conflict` still waits
 * (Lervo ADE coordination, "Conflicts"). It waits only while a holder overlaps the stage's own
 * paths, judged as the claim judges them: another assignment's live write lease, or a
 * conversation's unsealed or unintegrated change. A stage whose unfinished assignment overlaps
 * nothing retries now. A failure record that names no such assignment keeps the earlier, broader
 * hold: any live write lease.
 */
export async function convergencePathConflictHolds(
  repositoryRoot: string,
  dependency: ConvergencePathConflictDependency,
  now: Date = new Date(),
): Promise<boolean> {
  const assignments = await listAssignments(repositoryRoot);
  const stageAssignments = assignments.filter(
    (assignment) =>
      dependency.obligationId !== undefined &&
      assignment.convergence?.obligationId === dependency.obligationId &&
      assignment.convergence.stage === dependency.stage &&
      assignment.accessMode !== "read_only" &&
      !FINISHED.has(assignment.status),
  );
  if (stageAssignments.length === 0)
    return assignments.some(
      (assignment) =>
        assignment.status === "leased" &&
        assignment.accessMode !== "read_only" &&
        Date.parse(assignment.lease?.expiresAt ?? "") > now.getTime(),
    );
  for (const assignment of stageAssignments)
    if (
      (await readAssignmentClaimRefusals({ repositoryRoot, assignment, assignments, now })).length >
      0
    )
      return true;
  return false;
}
