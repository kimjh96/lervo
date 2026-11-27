import {
  type AssignmentCancellationHolder,
  type AssignmentCancellationStep,
  createAssignmentCancellationPlan,
} from "./assignment-graph.js";
import { type WorkforceEventRecorder, type WorkforceAssignment } from "./types.js";
import { fail } from "./workforce-state-validation.js";
import { readAssignmentState, listAssignments, assignmentPath } from "./assignment-state.js";
import { transition, retryConcurrent } from "./workforce-state-io.js";

export async function cancelAssignmentOnce(input: {
  repositoryRoot: string;
  assignmentId: string;
  reason: AssignmentCancellationStep["reason"];
  expectedPlanId: string;
  /** A holder-bound cancellation: ends the live lease only while it is exactly this one. */
  holder?: AssignmentCancellationHolder;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
  /** Revalidate caller authority while the exact assignment transition is locked. */
  beforeWrite?(): Promise<void>;
}): Promise<WorkforceAssignment> {
  if (!/^acp_[a-f0-9]{24}$/u.test(input.expectedPlanId)) {
    fail("assignment_invalid", "The assignment cancellation plan ID is invalid.");
  }
  const now = input.now ?? new Date();
  const [assignmentState, assignments] = await Promise.all([
    readAssignmentState(input.repositoryRoot, input.assignmentId),
    listAssignments(input.repositoryRoot),
  ]);
  const planAssignments = assignments.map((assignment) =>
    assignment.assignmentId === input.assignmentId ? assignmentState.value : assignment,
  );
  const plan = createAssignmentCancellationPlan({
    assignments: planAssignments,
    assignmentId: input.assignmentId,
    reason: input.reason,
    now,
    ...(input.holder === undefined ? {} : { holder: input.holder }),
  });
  if (plan.planId !== input.expectedPlanId) {
    fail("agent_state_conflict", "The assignment cancellation plan is stale.");
  }
  if (plan.status !== "ready") {
    fail(
      "assignment_cancellation_blocked",
      `The assignment cancellation is ${plan.status}: ${plan.blockedReason ?? "unknown"}.`,
    );
  }
  const next: WorkforceAssignment = {
    ...assignmentState.value,
    status: "cancelled",
    lease: null,
    revision: assignmentState.value.revision + 1,
    updatedAt: now.toISOString(),
  };
  const target = await assignmentPath(input.repositoryRoot, input.assignmentId);
  return transition({
    path: target.path,
    lockPath: target.lockPath,
    now,
    content: `${JSON.stringify(next, null, 2)}\n`,
    result: structuredClone(next),
    expectedBefore: assignmentState.source,
    ...(input.beforeWrite === undefined ? {} : { beforeWrite: input.beforeWrite }),
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    event: {
      type: "assignment.cancelled",
      occurredAt: next.updatedAt,
      actorAgentId: null,
      payload: {
        assignmentId: next.assignmentId,
        previousStatus: plan.previousStatus,
        reason: plan.reason,
        planId: plan.planId,
        cancelledDependencyIds: plan.cancelledDependencyIds,
        revision: next.revision,
      },
    },
  });
}

export function cancelAssignment(
  input: Parameters<typeof cancelAssignmentOnce>[0],
): Promise<WorkforceAssignment> {
  return retryConcurrent(() => cancelAssignmentOnce(input));
}
