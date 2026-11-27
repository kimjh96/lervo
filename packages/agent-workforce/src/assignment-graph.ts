import { createHash } from "node:crypto";

import { workforceLimits } from "./limits.js";
import type { WorkforceAssignment } from "./types.js";

export interface AssignmentCancellationStep {
  assignmentId: string;
  reason: "requested" | "dependency_cancelled";
}

export interface AssignmentCancellationPlan {
  schemaVersion: 1;
  planId: string;
  status: "ready" | "current" | "blocked";
  assignmentId: string;
  expectedRevision: number;
  previousStatus: WorkforceAssignment["status"];
  reason: AssignmentCancellationStep["reason"];
  cancelledDependencyIds: string[];
  blockedReason: "active_lease" | "terminal" | "dependency_not_cancelled" | null;
  /**
   * The live lease the cancellation ends, when its caller names the holder's exact agent and
   * lease: a holder-bound cancellation, such as retiring a conversation. Absent otherwise, so
   * every other plan keeps its ID.
   */
  holder?: AssignmentCancellationHolder;
}

/** The exact holder of a live lease that a holder-bound cancellation ends. */
export interface AssignmentCancellationHolder {
  agentId: string;
  leaseId: string;
}

function cancellationPlanId(content: Omit<AssignmentCancellationPlan, "planId">): string {
  const hash = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 24);
  return `acp_${hash}`;
}

export function createAssignmentCancellationPlan(input: {
  assignments: readonly WorkforceAssignment[];
  assignmentId: string;
  reason: AssignmentCancellationStep["reason"];
  now?: Date;
  /** Ends a live lease only while it is still exactly this holder's. */
  holder?: AssignmentCancellationHolder;
}): AssignmentCancellationPlan {
  if (
    input.assignments.length > workforceLimits.maximumAssignments ||
    !["requested", "dependency_cancelled"].includes(input.reason)
  ) {
    throw new TypeError("Assignment cancellation coordinates exceed their bounds.");
  }
  const assignment = input.assignments.find((item) => item.assignmentId === input.assignmentId);
  if (assignment === undefined) {
    throw new TypeError("Assignment cancellation input names an unknown assignment.");
  }
  const byId = new Map(input.assignments.map((item) => [item.assignmentId, item]));
  if (byId.size !== input.assignments.length) {
    throw new TypeError("Assignment cancellation input contains duplicate assignments.");
  }
  const cancelledDependencyIds = assignment.dependencyIds
    .filter((dependencyId) => byId.get(dependencyId)?.status === "cancelled")
    .sort();
  const terminal = ["completed", "failed", "cancelled"].includes(assignment.status);
  const lease = assignment.lease;
  const heldByNamedHolder =
    input.holder !== undefined &&
    lease != null &&
    lease.agentId === input.holder.agentId &&
    lease.leaseId === input.holder.leaseId;
  const blockedReason = terminal
    ? ("terminal" as const)
    : // An expired lease cannot commit a result; only a live holder blocks cancellation, unless
      // the caller names that holder's exact lease.
      assignment.status === "leased" &&
        !heldByNamedHolder &&
        (!lease || Date.parse(lease.expiresAt) > (input.now ?? new Date()).getTime())
      ? ("active_lease" as const)
      : input.reason === "dependency_cancelled" && cancelledDependencyIds.length === 0
        ? ("dependency_not_cancelled" as const)
        : null;
  const content: Omit<AssignmentCancellationPlan, "planId"> = {
    schemaVersion: 1,
    status: terminal ? "current" : blockedReason === null ? "ready" : "blocked",
    assignmentId: assignment.assignmentId,
    expectedRevision: assignment.revision,
    previousStatus: assignment.status,
    reason: input.reason,
    cancelledDependencyIds,
    blockedReason,
    ...(input.holder === undefined
      ? {}
      : { holder: { agentId: input.holder.agentId, leaseId: input.holder.leaseId } }),
  };
  return { ...content, planId: cancellationPlanId(content) };
}

export function planAssignmentCancellation(input: {
  assignments: readonly Pick<WorkforceAssignment, "assignmentId" | "dependencyIds" | "status">[];
  requestedAssignmentIds: readonly string[];
}): AssignmentCancellationStep[] {
  if (
    input.assignments.length > workforceLimits.maximumAssignments ||
    input.requestedAssignmentIds.length === 0 ||
    input.requestedAssignmentIds.length > workforceLimits.maximumAssignmentDependencies
  ) {
    throw new TypeError("Assignment cancellation coordinates exceed their bounds.");
  }
  const byId = new Map(
    input.assignments.map((assignment) => [assignment.assignmentId, assignment]),
  );
  if (byId.size !== input.assignments.length) {
    throw new TypeError("Assignment cancellation input contains duplicate assignments.");
  }
  const requested = new Set(input.requestedAssignmentIds);
  if ([...requested].some((assignmentId) => !byId.has(assignmentId))) {
    throw new TypeError("Assignment cancellation input names an unknown assignment.");
  }
  const selected = new Set(requested);
  let changed = true;
  while (changed) {
    changed = false;
    for (const assignment of input.assignments) {
      if (
        !selected.has(assignment.assignmentId) &&
        assignment.dependencyIds.some((dependencyId) => selected.has(dependencyId))
      ) {
        selected.add(assignment.assignmentId);
        changed = true;
      }
    }
  }
  const terminal = new Set(["completed", "failed", "cancelled"]);
  return [...selected]
    .map((assignmentId) => byId.get(assignmentId)!)
    .filter((assignment) => !terminal.has(assignment.status))
    .sort((left, right) => left.assignmentId.localeCompare(right.assignmentId))
    .map((assignment) => ({
      assignmentId: assignment.assignmentId,
      reason: requested.has(assignment.assignmentId) ? "requested" : "dependency_cancelled",
    }));
}
