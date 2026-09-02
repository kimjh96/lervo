import type {
  AssignmentRoutineAssignmentObservationV1,
  AssignmentRoutineBlockedReasonV1,
  AssignmentRoutinePlanStepV1,
  AssignmentRoutinePlanV1,
  AssignmentRoutineRequestV1,
  AssignmentRoutineRoleContractV1,
} from "@lervo/application-contract";
import {
  assignmentRoutineDigest,
  assignmentRoutineMaterialization,
  assignmentRoutineOpaqueId,
  assignmentRoutineProjectId,
  assignmentRoutineWorkstreamId,
  stableAssignmentRoutineJson,
  validateAndOrderAssignmentRoutineRequest,
} from "./assignment-routine-validation.js";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function assignmentSnapshotHash(assignments: AssignmentRoutineAssignmentObservationV1[]): string {
  return assignmentRoutineDigest(
    [...assignments]
      .sort((left, right) => left.assignmentId.localeCompare(right.assignmentId))
      .map((item) => ({
        assignmentId: item.assignmentId,
        revision: item.revision,
        status: item.status,
        routine: item.routine,
      })),
  );
}

function matches(
  assignment: AssignmentRoutineAssignmentObservationV1,
  expected: ReturnType<typeof assignmentRoutineMaterialization>,
  routine: NonNullable<AssignmentRoutineAssignmentObservationV1["routine"]>,
): boolean {
  return (
    assignment.taskType === expected.taskType &&
    assignment.roleId === expected.roleId &&
    assignment.roleVersion === expected.roleVersion &&
    assignment.roleContractHash === expected.roleContractHash &&
    assignment.requiredCapabilityHash === expected.requiredCapabilityHash &&
    assignment.priority === expected.priority &&
    assignment.acceptanceDigest === expected.acceptanceDigest &&
    assignment.verificationDigest === expected.verificationDigest &&
    assignment.approvalDigest === expected.approvalDigest &&
    assignment.expectedPathDigest === expected.expectedPathDigest &&
    stableAssignmentRoutineJson(assignment.dependencyIds) ===
      stableAssignmentRoutineJson(expected.dependencyIds) &&
    stableAssignmentRoutineJson(assignment.routine) === stableAssignmentRoutineJson(routine)
  );
}

function finishPlan(content: Omit<AssignmentRoutinePlanV1, "planId">): AssignmentRoutinePlanV1 {
  return { ...content, planId: assignmentRoutineOpaqueId("rplan", content) };
}

export function createAssignmentRoutinePlan(input: {
  projectId: string;
  currentWorkstreamId: string;
  request: AssignmentRoutineRequestV1;
  roleContracts: AssignmentRoutineRoleContractV1[];
  assignments: AssignmentRoutineAssignmentObservationV1[];
  maximumAssignments?: number;
}): AssignmentRoutinePlanV1 {
  if (
    !assignmentRoutineProjectId.test(input.projectId) ||
    !assignmentRoutineWorkstreamId.test(input.currentWorkstreamId)
  )
    throw new TypeError("The assignment routine repository coordinates are invalid.");
  if (input.assignments.length > (input.maximumAssignments ?? 10_000))
    throw new TypeError("The assignment routine observation exceeds assignment capacity.");
  const nodes = validateAndOrderAssignmentRoutineRequest(input.request);
  const templateHash = assignmentRoutineDigest(input.request.template);
  const triggerDigest = assignmentRoutineDigest(input.request.trigger);
  const invocationId = assignmentRoutineOpaqueId("rin", {
    projectId: input.projectId,
    workstreamId: input.request.workstreamId,
    routineId: input.request.template.routineId,
    templateVersion: input.request.template.templateVersion,
    templateHash,
    idempotencyKey: input.request.trigger.idempotencyKey,
  });
  const snapshotHash = assignmentSnapshotHash(input.assignments);
  const blockedReasons: AssignmentRoutineBlockedReasonV1[] = [];
  if (input.request.workstreamId !== input.currentWorkstreamId)
    blockedReasons.push("workstream_mismatch");
  const contracts = new Map(input.roleContracts.map((contract) => [contract.roleId, contract]));
  if (contracts.size !== input.roleContracts.length) blockedReasons.push("role_contract_stale");
  for (const node of nodes) {
    const contract = contracts.get(node.roleId);
    if (contract === undefined) blockedReasons.push("role_contract_missing");
    else if (
      contract.roleVersion !== node.roleVersion ||
      contract.roleContractHash !== node.roleContractHash
    )
      blockedReasons.push("role_contract_stale");
  }

  const routineAssignments = input.assignments.filter(
    (assignment) => assignment.routine?.routineId === input.request.template.routineId,
  );
  const activeInvocationIds = [
    ...new Set(
      routineAssignments
        .filter((assignment) => !TERMINAL.has(assignment.status))
        .map((assignment) => assignment.routine!.invocationId),
    ),
  ].sort();
  const sameInvocation = routineAssignments.filter(
    (assignment) => assignment.routine?.invocationId === invocationId,
  );
  const byNode = new Map(
    sameInvocation.map((assignment) => [assignment.routine!.nodeKey, assignment]),
  );
  if (
    byNode.size !== sameInvocation.length ||
    sameInvocation.some((item) => !nodes.some((node) => node.nodeKey === item.routine!.nodeKey))
  )
    blockedReasons.push("existing_assignment_mismatch");

  const ids = new Map(
    nodes.map((node) => [
      node.nodeKey,
      assignmentRoutineOpaqueId("asn", {
        projectId: input.projectId,
        invocationId,
        nodeKey: node.nodeKey,
      }),
    ]),
  );
  const steps: AssignmentRoutinePlanStepV1[] = [];
  for (const node of nodes) {
    const dependencyIds = node.dependencyNodeKeys.map((key) => ids.get(key)!).sort();
    const expected = assignmentRoutineMaterialization(node, dependencyIds);
    const routine = {
      routineId: input.request.template.routineId,
      templateVersion: input.request.template.templateVersion,
      templateHash,
      invocationId,
      triggerKind: input.request.trigger.kind,
      triggerDigest,
      nodeKey: node.nodeKey,
    } as const;
    const existing = byNode.get(node.nodeKey);
    if (existing !== undefined) {
      if (existing.assignmentId !== ids.get(node.nodeKey) || !matches(existing, expected, routine))
        blockedReasons.push("existing_assignment_mismatch");
      continue;
    }
    steps.push({
      nodeKey: node.nodeKey,
      assignmentId: ids.get(node.nodeKey)!,
      dependencyIds,
      roleId: node.roleId,
      roleVersion: node.roleVersion,
      roleContractHash: node.roleContractHash,
      requiredCapabilityHash: node.requiredCapabilityHash,
      materializationDigest: assignmentRoutineDigest({ ...expected, routine }),
    });
  }

  const uniqueBlocked = [...new Set(blockedReasons)].sort();
  if (uniqueBlocked.length > 0)
    return finishPlan({
      schemaVersion: 1,
      status: "blocked",
      disposition: "blocked",
      projectId: input.projectId,
      workstreamId: input.currentWorkstreamId,
      routineId: input.request.template.routineId,
      templateVersion: input.request.template.templateVersion,
      templateHash,
      invocationId,
      triggerDigest,
      assignmentSnapshotHash: snapshotHash,
      activeInvocationIds,
      relatedInvocationId: null,
      steps: [],
      blockedReasons: uniqueBlocked,
    });

  if (sameInvocation.length > 0) {
    const complete = steps.length === 0;
    return finishPlan({
      schemaVersion: 1,
      status: complete ? "current" : "ready",
      disposition: complete ? "already_materialized" : "resume",
      projectId: input.projectId,
      workstreamId: input.currentWorkstreamId,
      routineId: input.request.template.routineId,
      templateVersion: input.request.template.templateVersion,
      templateHash,
      invocationId,
      triggerDigest,
      assignmentSnapshotHash: snapshotHash,
      activeInvocationIds,
      relatedInvocationId: invocationId,
      steps,
      blockedReasons: [],
    });
  }

  const concurrency = input.request.template.concurrency;
  if (concurrency.mode !== "enqueue_bounded" && activeInvocationIds.length > 1)
    return finishPlan({
      schemaVersion: 1,
      status: "blocked",
      disposition: "blocked",
      projectId: input.projectId,
      workstreamId: input.currentWorkstreamId,
      routineId: input.request.template.routineId,
      templateVersion: input.request.template.templateVersion,
      templateHash,
      invocationId,
      triggerDigest,
      assignmentSnapshotHash: snapshotHash,
      activeInvocationIds,
      relatedInvocationId: null,
      steps: [],
      blockedReasons: ["concurrency_state_invalid"],
    });
  if (concurrency.mode !== "enqueue_bounded" && activeInvocationIds.length === 1)
    return finishPlan({
      schemaVersion: 1,
      status: "current",
      disposition: concurrency.mode === "skip_if_active" ? "skipped" : "coalesced",
      projectId: input.projectId,
      workstreamId: input.currentWorkstreamId,
      routineId: input.request.template.routineId,
      templateVersion: input.request.template.templateVersion,
      templateHash,
      invocationId,
      triggerDigest,
      assignmentSnapshotHash: snapshotHash,
      activeInvocationIds,
      relatedInvocationId:
        concurrency.mode === "coalesce_if_active" ? activeInvocationIds[0]! : null,
      steps: [],
      blockedReasons: [],
    });
  if (activeInvocationIds.length >= concurrency.maximumActiveInstances)
    blockedReasons.push("routine_concurrency_limit");
  if (input.assignments.length + steps.length > (input.maximumAssignments ?? 10_000))
    blockedReasons.push("assignment_capacity");
  if (blockedReasons.length > 0)
    return finishPlan({
      schemaVersion: 1,
      status: "blocked",
      disposition: "blocked",
      projectId: input.projectId,
      workstreamId: input.currentWorkstreamId,
      routineId: input.request.template.routineId,
      templateVersion: input.request.template.templateVersion,
      templateHash,
      invocationId,
      triggerDigest,
      assignmentSnapshotHash: snapshotHash,
      activeInvocationIds,
      relatedInvocationId: null,
      steps: [],
      blockedReasons: [...new Set(blockedReasons)].sort(),
    });
  return finishPlan({
    schemaVersion: 1,
    status: "ready",
    disposition: "materialize",
    projectId: input.projectId,
    workstreamId: input.currentWorkstreamId,
    routineId: input.request.template.routineId,
    templateVersion: input.request.template.templateVersion,
    templateHash,
    invocationId,
    triggerDigest,
    assignmentSnapshotHash: snapshotHash,
    activeInvocationIds,
    relatedInvocationId: null,
    steps,
    blockedReasons: [],
  });
}
