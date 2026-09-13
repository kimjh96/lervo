import type { SupervisedAssignmentAmendmentV1 } from "@lervo/application-contract";
import { operatingContractHash } from "@lervo/work-controller";
import { amendedAssignment } from "./assignment-amendment-state.js";
import { assignmentPath, readAssignmentState } from "./assignment-state.js";
import { transition } from "./workforce-state-io.js";
import type { WorkforceEventRecorder } from "./types.js";

export async function amendAssignment(input: {
  repositoryRoot: string;
  effect: SupervisedAssignmentAmendmentV1;
  now: Date;
  recordEvent: WorkforceEventRecorder;
}) {
  const current = await readAssignmentState(
    input.repositoryRoot,
    input.effect.responsibility.assignmentId,
  );
  const next = amendedAssignment(current.value, input.effect, input.now.toISOString());
  const target = await assignmentPath(input.repositoryRoot, next.assignmentId);
  return transition({
    path: target.path,
    lockPath: target.lockPath,
    now: input.now,
    content: `${JSON.stringify(next, null, 2)}\n`,
    expectedBefore: current.source,
    result: structuredClone(next),
    recordEvent: input.recordEvent,
    event: {
      type: "assignment.amended",
      occurredAt: next.updatedAt,
      actorAgentId: null,
      payload: {
        assignmentId: next.assignmentId,
        assignmentRevision: next.revision,
        assignmentHash: operatingContractHash(next),
        ...next.amendment,
      },
    },
  });
}
