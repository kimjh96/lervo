import type {
  ApprovalObservationV1,
  GovernedLoopActionV1,
  GovernedLoopDecisionV1,
  GovernedLoopPolicyV1,
  ManagedAttemptObservationV1,
  ResourceGroupObservationV1,
  WorkGraphNodeV1,
  WorkGraphV1,
} from "@lervo/application-contract";

import { shortId } from "./hash.js";
import { evaluateResourceAdmission } from "./resource-admission.js";

function dispositionAction(
  disposition: "block" | "escalate",
  reasonCode: Extract<GovernedLoopActionV1, { kind: "block" | "escalate" }>["reasonCode"],
  assignmentId: string | null,
): GovernedLoopActionV1 {
  return { kind: disposition, assignmentId, reasonCode };
}

function cancellationActions(nodes: readonly WorkGraphNodeV1[]): GovernedLoopActionV1[] {
  const cancelled = new Set(
    nodes.filter((node) => node.status === "cancelled").map((node) => node.assignmentId),
  );
  if (cancelled.size === 0) return [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (
        !cancelled.has(node.assignmentId) &&
        node.dependencyIds.some((dependencyId) => cancelled.has(dependencyId))
      ) {
        cancelled.add(node.assignmentId);
        changed = true;
      }
    }
  }
  return nodes
    .filter(
      (node) =>
        cancelled.has(node.assignmentId) &&
        !["completed", "failed", "cancelled"].includes(node.status),
    )
    .map((node) => ({
      kind: "cancel_assignment" as const,
      assignmentId: node.assignmentId,
      reasonCode: "dependency_cancelled" as const,
    }));
}

function approvalAction(
  node: WorkGraphNodeV1,
  observations: ReadonlyMap<string, ApprovalObservationV1>,
): GovernedLoopActionV1 | null {
  const missing = node.approvalRequirementDigests.filter(
    (digest) => observations.get(digest)?.status !== "verified",
  );
  if (missing.length === 0) return null;
  return {
    kind: "await_approval",
    assignmentId: node.assignmentId,
    reasonCode: missing.some((digest) => observations.get(digest)?.status === "invalid")
      ? "approval_invalid"
      : "approval_missing",
    requirementDigests: missing,
  };
}

function attemptAction(input: {
  node: WorkGraphNodeV1;
  attempts: readonly ManagedAttemptObservationV1[];
  policy: GovernedLoopPolicyV1;
  workstreamId: string;
}): GovernedLoopActionV1 {
  const attempts = input.attempts
    .filter((attempt) => attempt.assignmentId === input.node.assignmentId)
    .sort((left, right) => left.attemptOrdinal - right.attemptOrdinal);
  const latest = attempts.at(-1);
  if (latest === undefined) {
    return {
      kind: "start_attempt",
      assignmentId: input.node.assignmentId,
      reasonCode: "ready",
      causality: {
        relationship: "root",
        workstreamId: input.workstreamId,
        assignmentId: input.node.assignmentId,
        agentId: input.node.assigneeAgentId!,
      },
    };
  }
  if (latest.terminalStatus === "in_progress") {
    return { kind: "wait", assignmentId: input.node.assignmentId, reasonCode: "active_attempt" };
  }
  if (latest.terminalStatus === "completed" && latest.verificationStatus === "passed") {
    return dispositionAction(
      "escalate",
      "completion_reconciliation_required",
      input.node.assignmentId,
    );
  }
  if (attempts.length >= input.policy.maxAttemptsPerAssignment) {
    return dispositionAction(
      input.policy.terminalFailureAction,
      "attempts_exhausted",
      input.node.assignmentId,
    );
  }
  return {
    kind: "retry_attempt",
    assignmentId: input.node.assignmentId,
    reasonCode: "attempt_failed",
    causality: {
      relationship: "retry",
      workId: latest.workId,
      parentRunId: latest.runId,
      retryOfRunId: latest.runId,
      attemptOrdinal: latest.attemptOrdinal + 1,
      workstreamId: input.workstreamId,
      assignmentId: input.node.assignmentId,
      agentId: input.node.assigneeAgentId!,
    },
  };
}

function statusOf(actions: readonly GovernedLoopActionV1[]): GovernedLoopDecisionV1["status"] {
  if (actions.some((action) => action.kind === "escalate")) return "escalation_required";
  if (actions.some((action) => action.kind === "block" || action.kind === "await_approval")) {
    return "blocked";
  }
  if (actions.some((action) => action.kind === "complete_work")) return "complete";
  if (
    actions.some((action) =>
      ["claim_assignment", "start_attempt", "retry_attempt", "cancel_assignment"].includes(
        action.kind,
      ),
    )
  ) {
    return "ready";
  }
  return "waiting";
}

export function decideGovernedLoop(input: {
  graph: WorkGraphV1;
  attempts: readonly ManagedAttemptObservationV1[];
  resources: readonly ResourceGroupObservationV1[];
  approvals?: readonly ApprovalObservationV1[];
  policy: GovernedLoopPolicyV1;
}): GovernedLoopDecisionV1 {
  let actions: GovernedLoopActionV1[];
  const approvalList = [...(input.approvals ?? [])].sort((left, right) =>
    left.requirementDigest.localeCompare(right.requirementDigest),
  );
  const approvalCoordinatesValid =
    new Set(approvalList.map((approval) => approval.requirementDigest)).size ===
    approvalList.length;
  if (!approvalCoordinatesValid) {
    actions = [dispositionAction("block", "approval_observation_invalid", null)];
  } else if (input.graph.validity.status === "invalid") {
    actions = [dispositionAction("block", "graph_invalid", null)];
  } else if (input.graph.nodes.length === 0) {
    actions = [{ kind: "wait", assignmentId: null, reasonCode: "no_assignments" }];
  } else if (input.graph.nodes.every((node) => node.status === "completed")) {
    actions = [
      { kind: "complete_work", assignmentId: null, reasonCode: "all_assignments_completed" },
    ];
  } else {
    const resourceAction = evaluateResourceAdmission(input);
    if (resourceAction !== null) {
      actions = [resourceAction];
    } else {
      const cancelled = cancellationActions(input.graph.nodes);
      if (cancelled.length > 0) {
        actions = cancelled;
      } else if (input.graph.nodes.some((node) => node.status === "cancelled")) {
        actions = [dispositionAction(input.policy.terminalFailureAction, "work_cancelled", null)];
      } else {
        const failed = input.graph.nodes.find((node) => node.status === "failed");
        const blocked = input.graph.nodes.find((node) => node.status === "blocked");
        if (failed !== undefined) {
          actions = [
            dispositionAction(
              input.policy.terminalFailureAction,
              "assignment_failed",
              failed.assignmentId,
            ),
          ];
        } else if (blocked !== undefined) {
          actions = [
            dispositionAction(
              input.policy.terminalFailureAction,
              "assignment_blocked",
              blocked.assignmentId,
            ),
          ];
        } else {
          const completed = new Set(
            input.graph.nodes
              .filter((node) => node.status === "completed")
              .map((node) => node.assignmentId),
          );
          const approvals = new Map(
            approvalList.map((observation) => [observation.requirementDigest, observation]),
          );
          const candidates = input.graph.nodes
            .filter((node) => !["completed", "failed", "cancelled"].includes(node.status))
            .sort(
              (left, right) =>
                right.priority - left.priority ||
                left.assignmentId.localeCompare(right.assignmentId),
            );
          const ready: GovernedLoopActionV1[] = [];
          const waiting: GovernedLoopActionV1[] = [];
          const activeAttemptCount = input.attempts.filter(
            (attempt) => attempt.terminalStatus === "in_progress",
          ).length;
          const availableParallelSlots = Math.max(
            0,
            input.policy.maxParallelAssignments - activeAttemptCount,
          );
          for (const node of candidates) {
            if (node.dependencyIds.some((dependencyId) => !completed.has(dependencyId))) {
              waiting.push({
                kind: "wait",
                assignmentId: node.assignmentId,
                reasonCode: "dependencies_incomplete",
              });
              continue;
            }
            const approval = approvalAction(node, approvals);
            if (approval !== null) {
              waiting.push(approval);
              continue;
            }
            if (node.status === "queued" || node.leaseState !== "active") {
              ready.push({
                kind: "claim_assignment",
                assignmentId: node.assignmentId,
                reasonCode: node.leaseState === "expired" ? "lease_expired" : "ready",
              });
            } else {
              const attempt = attemptAction({
                node,
                attempts: input.attempts,
                policy: input.policy,
                workstreamId: input.graph.workstreamId,
              });
              if (attempt.kind === "wait") waiting.push(attempt);
              else ready.push(attempt);
            }
          }
          actions =
            ready.length > 0 && availableParallelSlots > 0
              ? ready.slice(0, availableParallelSlots)
              : waiting.length > 0
                ? waiting
                : [{ kind: "wait", assignmentId: null, reasonCode: "dependencies_incomplete" }];
        }
      }
    }
  }
  const status =
    input.graph.validity.status === "invalid" || !approvalCoordinatesValid
      ? "invalid"
      : statusOf(actions);
  return {
    schemaVersion: 1,
    decisionId: shortId("gld", {
      graphHash: input.graph.graphHash,
      policy: input.policy,
      approvals: approvalList,
      actions,
    }),
    graphHash: input.graph.graphHash,
    status,
    actions,
  };
}
