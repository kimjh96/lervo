import type {
  UnattendedSchedulerAgentV1,
  UnattendedSchedulerAssignmentV1,
  UnattendedSchedulerSelectionInputV1,
  UnattendedSchedulerSelectionV1,
} from "@lervo/application-contract";

import { shortId } from "./hash.js";

function ownsPath(responsibilityPaths: readonly string[], expectedPath: string): boolean {
  return responsibilityPaths.some(
    (scope) => scope === "*" || expectedPath === scope || expectedPath.startsWith(`${scope}/`),
  );
}

function compatibleAgent(input: {
  agent: UnattendedSchedulerAgentV1;
  assignment: UnattendedSchedulerAssignmentV1;
  provider: UnattendedSchedulerSelectionInputV1["provider"];
  eligibleAgentIds: ReadonlySet<string>;
}): boolean {
  const { agent, assignment } = input;
  return (
    agent.status === "active" &&
    (input.eligibleAgentIds.size === 0 || input.eligibleAgentIds.has(agent.agentId)) &&
    (agent.provider === "any" || agent.provider === input.provider) &&
    agent.roleId === assignment.roleId &&
    agent.roleVersion === assignment.roleVersion &&
    agent.roleContractHash === assignment.roleContractHash &&
    (assignment.requiredCapabilityHash === null ||
      assignment.requiredCapabilityHash === agent.capabilityHash) &&
    assignment.expectedPaths.every((path) => ownsPath(agent.responsibilityPaths, path))
  );
}

function selection<T extends Omit<UnattendedSchedulerSelectionV1, "decisionId">>(
  input: UnattendedSchedulerSelectionInputV1,
  value: T,
): UnattendedSchedulerSelectionV1 {
  return {
    ...value,
    decisionId: shortId("usd", {
      schedulerSessionId: input.schedulerSessionId,
      provider: input.provider,
      eligibleAgentIds: [...input.eligibleAgentIds].sort(),
      graphHash: input.report.graph.graphHash,
      governedDecisionId: input.report.decision.decisionId,
      selection: value,
    }),
  } as UnattendedSchedulerSelectionV1;
}

function stop(
  input: UnattendedSchedulerSelectionInputV1,
  reasonCode: Extract<UnattendedSchedulerSelectionV1, { kind: "stop" }>["reasonCode"],
  assignmentId: string | null,
  governedReasonCode: string | null,
): UnattendedSchedulerSelectionV1 {
  return selection(input, {
    schemaVersion: 1,
    graphHash: input.report.graph.graphHash,
    kind: "stop",
    reasonCode,
    assignmentId,
    governedReasonCode,
  });
}

export function selectUnattendedSchedulerAction(
  input: UnattendedSchedulerSelectionInputV1,
): UnattendedSchedulerSelectionV1 {
  const eligibleAgentIds = new Set(input.eligibleAgentIds);
  const assignments = new Map(input.assignments.map((item) => [item.assignmentId, item]));
  const nodes = new Map(input.report.graph.nodes.map((item) => [item.assignmentId, item]));
  const compatibleAgents = (assignment: UnattendedSchedulerAssignmentV1) =>
    input.agents
      .filter((agent) =>
        compatibleAgent({ agent, assignment, provider: input.provider, eligibleAgentIds }),
      )
      .sort(
        (left, right) =>
          Number(right.provider === input.provider) - Number(left.provider === input.provider) ||
          left.agentId.localeCompare(right.agentId),
      );

  if (input.report.decision.status === "invalid") {
    const action = input.report.decision.actions[0];
    return stop(
      input,
      "governed_invalid",
      action?.assignmentId ?? null,
      action?.reasonCode ?? null,
    );
  }
  if (
    input.report.decision.status === "blocked" &&
    input.report.decision.actions.length > 0 &&
    input.report.decision.actions.every((action) => action.kind === "await_approval")
  ) {
    return selection(input, {
      schemaVersion: 1,
      graphHash: input.report.graph.graphHash,
      kind: "wait",
      reasonCode: "approval_pending",
      assignmentId: input.report.decision.actions[0]!.assignmentId,
    });
  }
  if (
    input.report.decision.status === "blocked" ||
    input.report.decision.status === "escalation_required"
  ) {
    const action = input.report.decision.actions[0];
    return stop(
      input,
      input.report.decision.status === "blocked"
        ? "governed_blocked"
        : "governed_escalation_required",
      action?.assignmentId ?? null,
      action?.reasonCode ?? null,
    );
  }

  const reconciliation = input.report.decision.actions.find(
    (action) => action.kind === "reconcile_completion",
  );
  if (reconciliation !== undefined) {
    return stop(
      input,
      "completion_reconciliation_required",
      reconciliation.assignmentId,
      reconciliation.reasonCode,
    );
  }
  const cancellation = input.report.decision.actions.find(
    (action) => action.kind === "cancel_assignment",
  );
  if (cancellation !== undefined) {
    return stop(input, "cancellation_required", cancellation.assignmentId, cancellation.reasonCode);
  }
  if (input.report.decision.actions.some((action) => action.kind === "complete_work")) {
    return stop(input, "work_complete", null, "all_assignments_completed");
  }

  let foreignActiveAssignmentId: string | null = null;
  for (const action of input.report.decision.actions) {
    if (action.kind !== "start_attempt" && action.kind !== "retry_attempt") continue;
    const assignment = assignments.get(action.assignmentId);
    const node = nodes.get(action.assignmentId);
    if (
      assignment === undefined ||
      node === undefined ||
      assignment.revision !== node.assignmentRevision
    ) {
      return stop(input, "governed_invalid", action.assignmentId, "assignment_snapshot_mismatch");
    }
    const lease = assignment.lease;
    if (
      lease?.sessionId !== input.schedulerSessionId ||
      assignment.assigneeAgentId === null ||
      lease.leaseId !== node.leaseId
    ) {
      foreignActiveAssignmentId ??= assignment.assignmentId;
      continue;
    }
    const agent = compatibleAgents(assignment).find(
      (candidate) => candidate.agentId === assignment.assigneeAgentId,
    );
    if (agent === undefined) {
      return stop(input, "no_eligible_agent", assignment.assignmentId, null);
    }
    return selection(input, {
      schemaVersion: 1,
      graphHash: input.report.graph.graphHash,
      kind: "execute_assignment",
      reasonCode: action.reasonCode,
      attemptKind: action.kind,
      assignmentId: assignment.assignmentId,
      expectedAssignmentRevision: assignment.revision,
      agentId: agent.agentId,
      leaseId: lease.leaseId,
    });
  }

  for (const action of input.report.decision.actions) {
    if (action.kind !== "claim_assignment") continue;
    const assignment = assignments.get(action.assignmentId);
    const node = nodes.get(action.assignmentId);
    if (
      assignment === undefined ||
      node === undefined ||
      assignment.revision !== node.assignmentRevision
    ) {
      return stop(input, "governed_invalid", action.assignmentId, "assignment_snapshot_mismatch");
    }
    const agent = compatibleAgents(assignment)[0];
    if (agent === undefined) continue;
    return selection(input, {
      schemaVersion: 1,
      graphHash: input.report.graph.graphHash,
      kind: "claim_assignment",
      reasonCode: action.reasonCode,
      assignmentId: assignment.assignmentId,
      expectedAssignmentRevision: assignment.revision,
      agentId: agent.agentId,
    });
  }

  const claimable = input.report.decision.actions.some(
    (action) => action.kind === "claim_assignment",
  );
  if (claimable) return stop(input, "no_eligible_agent", null, null);
  if (foreignActiveAssignmentId !== null) {
    return selection(input, {
      schemaVersion: 1,
      graphHash: input.report.graph.graphHash,
      kind: "wait",
      reasonCode: "foreign_active_lease",
      assignmentId: foreignActiveAssignmentId,
    });
  }
  const action = input.report.decision.actions[0];
  return selection(input, {
    schemaVersion: 1,
    graphHash: input.report.graph.graphHash,
    kind: "wait",
    reasonCode:
      action?.kind === "await_approval"
        ? "approval_pending"
        : action?.reasonCode === "no_assignments"
          ? "no_assignments"
          : "dependencies_incomplete",
    assignmentId: action?.assignmentId ?? null,
  });
}
