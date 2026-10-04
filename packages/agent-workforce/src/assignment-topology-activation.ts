import type { WorkforceAssignment } from "./types.js";
import { fail } from "./workforce-state-validation.js";
import { transition, retryConcurrent } from "./workforce-state-io.js";
import { assignmentPath, readAssignmentState } from "./assignment-state.js";

export function activateTopologyAssignment(input: {
  repositoryRoot: string;
  assignmentId: string;
  changeId: string;
  now?: Date;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(async () => {
    const now = input.now ?? new Date();
    const target = await assignmentPath(input.repositoryRoot, input.assignmentId);
    const current = await readAssignmentState(input.repositoryRoot, input.assignmentId);
    if (current.value.topology?.changeId !== input.changeId)
      fail("assignment_invalid", "The assignment topology change binding is stale.");
    if (current.value.topology.policyReview !== undefined)
      fail("assignment_invalid", "Automatic topology requires a fenced responsibility claim.");
    if (current.value.status !== "blocked") return structuredClone(current.value);
    const assignment: WorkforceAssignment = {
      ...current.value,
      status: "queued",
      revision: current.value.revision + 1,
      updatedAt: now.toISOString(),
    };
    return transition({
      path: target.path,
      lockPath: target.lockPath,
      now,
      content: `${JSON.stringify(assignment, null, 2)}\n`,
      result: structuredClone(assignment),
      expectedBefore: current.source,
    });
  });
}
