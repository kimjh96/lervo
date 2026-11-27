import {
  judgeAssignmentPathConflicts,
  type AssignmentPathRefusal,
} from "./assignment-path-conflict.js";
import { readAssignmentClaimPathHolders } from "./conversation-path-holders.js";
import type { WorkforceAssignment } from "./types.js";
import { state } from "./workforce-state-io.js";

/**
 * What would refuse a claim of `assignment` now, judged as `claimAssignment` judges it: other
 * assignments' live write leases and conversations' changed paths over its expected paths (Lervo
 * ADE coordination, "Conflicts"). It reads without the scheduler lock and writes nothing, so a
 * waiter, such as a knowledge convergence stage a claim refused, can tell whether an overlapping
 * holder still exists. An empty list means nothing overlaps.
 */
export async function readAssignmentClaimRefusals(input: {
  repositoryRoot: string;
  assignment: WorkforceAssignment;
  /** Every assignment, as the caller read them. */
  assignments: readonly WorkforceAssignment[];
  now: Date;
}): Promise<AssignmentPathRefusal[]> {
  const paths = input.assignment.expectedPaths;
  const home = await state(input.repositoryRoot, { readOnly: true });
  const changedPathHolders = await readAssignmentClaimPathHolders({
    repositoryRoot: input.repositoryRoot,
    workforceDirectory: home.base,
    paths,
    assignments: input.assignments,
    now: input.now,
  });
  return judgeAssignmentPathConflicts({
    claimant: input.assignment,
    paths,
    assignments: input.assignments,
    now: input.now,
    changedPathHolders,
  });
}
