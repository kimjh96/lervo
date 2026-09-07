import type {
  AssignmentTopologyAssignmentObservationV2,
  AssignmentTopologyBlockedReasonV2,
  AssignmentTopologyChangeRequestV2,
  AssignmentTopologyPlanStepV2,
  AssignmentTopologyPlanV2,
  AssignmentTopologyRoleContractV2,
} from "@lervo/application-contract";

import {
  assignmentTopologyDigest,
  assignmentTopologyId,
  assignmentTopologyLimits,
  assignmentTopologyMaterialization,
  stableAssignmentTopologyJson,
  validateAndOrderAssignmentTopologyRequest,
} from "./assignment-topology-validation.js";

function snapshotHash(assignments: AssignmentTopologyAssignmentObservationV2[]): string {
  return assignmentTopologyDigest(
    [...assignments]
      .sort((left, right) => left.assignmentId.localeCompare(right.assignmentId))
      .map(({ assignmentId, revision, status, dependencyIds, topology, workstreamId }) => ({
        assignmentId,
        revision,
        status,
        dependencyIds,
        topology,
        workstreamId,
      })),
  );
}

function finishPlan(content: Omit<AssignmentTopologyPlanV2, "planId">): AssignmentTopologyPlanV2 {
  const planId = assignmentTopologyId("gtp", content);
  return { ...content, planId };
}

function matches(
  assignment: AssignmentTopologyAssignmentObservationV2,
  expected: ReturnType<typeof assignmentTopologyMaterialization>,
  identity: {
    changeId: string;
    changeKey: string;
    requestHash: string;
    approvalHash: string;
    expectedNodeCount: number;
    nodeSetHash: string;
    nodeKey: string;
  },
): boolean {
  const topology = assignment.topology;
  return (
    assignment.taskType === expected.taskType &&
    assignment.roleId === expected.roleId &&
    assignment.roleVersion === expected.roleVersion &&
    assignment.roleContractHash === expected.roleContractHash &&
    assignment.requiredCapabilityHash === expected.requiredCapabilityHash &&
    assignment.priority === expected.priority &&
    stableAssignmentTopologyJson(assignment.dependencyIds) ===
      stableAssignmentTopologyJson(expected.dependencyIds) &&
    assignment.acceptanceDigest === expected.acceptanceDigest &&
    assignment.verificationDigest === expected.verificationDigest &&
    assignment.approvalDigest === expected.approvalDigest &&
    assignment.expectedPathDigest === expected.expectedPathDigest &&
    topology !== null &&
    topology.contractVersion === 2 &&
    topology.changeId === identity.changeId &&
    topology.changeKey === identity.changeKey &&
    topology.requestHash === identity.requestHash &&
    topology.approvalHash === identity.approvalHash &&
    topology.expectedNodeCount === identity.expectedNodeCount &&
    topology.nodeSetHash === identity.nodeSetHash &&
    topology.nodeKey === identity.nodeKey
  );
}

function graphShape(input: {
  assignments: AssignmentTopologyAssignmentObservationV2[];
  created: Map<string, { assignmentId: string; dependencyIds: string[] }>;
}) {
  const dependencies = new Map(
    input.assignments.map((item) => [item.assignmentId, [...item.dependencyIds]]),
  );
  for (const item of input.created.values())
    dependencies.set(item.assignmentId, item.dependencyIds);
  const dependents = new Map<string, number>();
  for (const items of dependencies.values()) {
    for (const dependencyId of items) {
      dependents.set(dependencyId, (dependents.get(dependencyId) ?? 0) + 1);
    }
  }
  return {
    branchAssignmentIds: [...dependents]
      .filter(([, count]) => count > 1)
      .map(([assignmentId]) => assignmentId)
      .sort(),
    joinAssignmentIds: [...dependencies]
      .filter(([, items]) => items.length > 1)
      .map(([assignmentId]) => assignmentId)
      .sort(),
  };
}

export function createAssignmentTopologyPlan(input: {
  projectId: string;
  currentWorkstreamId: string;
  currentGraphHash: string;
  graphValid: boolean;
  request: AssignmentTopologyChangeRequestV2;
  roleContracts: AssignmentTopologyRoleContractV2[];
  assignments: AssignmentTopologyAssignmentObservationV2[];
  maximumAssignments?: number;
}): AssignmentTopologyPlanV2 {
  if (
    !/^prj_[a-f0-9]{16}$/u.test(input.projectId) ||
    !/^wks_[a-f0-9]{24}$/u.test(input.currentWorkstreamId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.currentGraphHash)
  ) {
    throw new TypeError("The assignment topology repository coordinates are invalid.");
  }
  const nodes = validateAndOrderAssignmentTopologyRequest(input.request);
  const requestHash = assignmentTopologyDigest(input.request);
  const changeId = assignmentTopologyId("gtc", {
    projectId: input.projectId,
    workstreamId: input.request.workstreamId,
    changeKey: input.request.changeKey,
    requestHash,
  });
  const nodeSetHash = assignmentTopologyDigest(nodes.map((node) => node.nodeKey).sort());
  const approvalHash = assignmentTopologyDigest({
    schemaVersion: 2,
    kind: "assignment_topology.approval",
    projectId: input.projectId,
    workstreamId: input.request.workstreamId,
    changeId,
    requestHash,
    nodeSetHash,
  });
  const blockedReasons: AssignmentTopologyBlockedReasonV2[] = [];
  if (input.request.workstreamId !== input.currentWorkstreamId)
    blockedReasons.push("workstream_mismatch");
  const workstreamAssignments = input.assignments.filter(
    (assignment) => assignment.workstreamId === input.request.workstreamId,
  );
  if (!input.graphValid) blockedReasons.push("graph_invalid");

  const existingSameChange = workstreamAssignments.filter(
    (assignment) => assignment.topology?.changeId === changeId,
  );
  const requestedNodeKeys = new Set(nodes.map((node) => node.nodeKey));
  if (
    existingSameChange.some(
      (assignment) =>
        assignment.topology === null || !requestedNodeKeys.has(assignment.topology.nodeKey),
    )
  ) {
    blockedReasons.push("existing_assignment_mismatch");
  }
  if (input.request.expectedGraphHash !== input.currentGraphHash && existingSameChange.length === 0)
    blockedReasons.push("graph_changed");
  const resultingAssignmentCount =
    workstreamAssignments.length + nodes.length - existingSameChange.length;
  if (resultingAssignmentCount > (input.maximumAssignments ?? 10_000)) {
    blockedReasons.push("assignment_capacity");
  }
  if (resultingAssignmentCount > assignmentTopologyLimits.maximumGraphNodes) {
    blockedReasons.push("topology_bounds_exceeded");
  }

  const currentIds = new Set(workstreamAssignments.map((assignment) => assignment.assignmentId));
  if (
    nodes.some((node) =>
      node.dependencyAssignmentIds.some((assignmentId) => !currentIds.has(assignmentId)),
    )
  ) {
    blockedReasons.push("dependency_escape");
  }

  const contracts = new Map(input.roleContracts.map((contract) => [contract.roleId, contract]));
  if (contracts.size !== input.roleContracts.length) blockedReasons.push("role_contract_stale");
  for (const node of nodes) {
    const contract = contracts.get(node.roleId);
    if (contract === undefined) blockedReasons.push("role_contract_missing");
    else if (
      contract.roleVersion !== node.roleVersion ||
      contract.roleContractHash !== node.roleContractHash
    ) {
      blockedReasons.push("role_contract_stale");
    }
  }

  const ids = new Map(
    nodes.map((node) => [
      node.nodeKey,
      assignmentTopologyId("asn", { projectId: input.projectId, changeId, nodeKey: node.nodeKey }),
    ]),
  );
  const created = new Map<string, { assignmentId: string; dependencyIds: string[] }>();
  const steps: AssignmentTopologyPlanStepV2[] = [];
  for (const node of nodes) {
    const dependencyIds = [
      ...node.dependencyAssignmentIds,
      ...node.dependencyNodeKeys.map((nodeKey) => ids.get(nodeKey)!),
    ].sort();
    if (new Set(dependencyIds).size !== dependencyIds.length) {
      blockedReasons.push("dependency_duplicate");
      continue;
    }
    const assignmentId = ids.get(node.nodeKey)!;
    created.set(node.nodeKey, { assignmentId, dependencyIds });
    const expected = assignmentTopologyMaterialization(node, dependencyIds);
    const existing = input.assignments.find(
      (assignment) => assignment.assignmentId === assignmentId,
    );
    if (existing !== undefined) {
      if (
        !matches(existing, expected, {
          changeId,
          changeKey: input.request.changeKey,
          requestHash,
          approvalHash,
          expectedNodeCount: nodes.length,
          nodeSetHash,
          nodeKey: node.nodeKey,
        })
      ) {
        blockedReasons.push("existing_assignment_mismatch");
      }
      continue;
    }
    steps.push({
      nodeKey: node.nodeKey,
      assignmentId,
      dependencyIds,
      roleId: node.roleId,
      roleVersion: node.roleVersion,
      roleContractHash: node.roleContractHash,
      requiredCapabilityHash: node.requiredCapabilityHash,
      materializationDigest: assignmentTopologyDigest(expected),
    });
  }

  const shape = graphShape({ assignments: workstreamAssignments, created });
  const uniqueBlocked = [...new Set(blockedReasons)].sort();
  const allExisting = steps.length === 0 && existingSameChange.length === nodes.length;
  const allActivated =
    allExisting && existingSameChange.every((assignment) => assignment.status !== "blocked");
  const base = {
    schemaVersion: 2 as const,
    kind: "assignment_topology.plan" as const,
    approvalHash,
    projectId: input.projectId,
    workstreamId: input.currentWorkstreamId,
    expectedGraphHash: input.request.expectedGraphHash,
    currentGraphHash: input.currentGraphHash,
    requestHash,
    assignmentSnapshotHash: snapshotHash(input.assignments),
    changeId,
    changeKey: input.request.changeKey,
    branchAssignmentIds: shape.branchAssignmentIds,
    joinAssignmentIds: shape.joinAssignmentIds,
  };
  if (uniqueBlocked.length > 0) {
    return finishPlan({
      ...base,
      status: "blocked",
      disposition: "blocked",
      steps: [],
      blockedReasons: uniqueBlocked,
    });
  }
  return finishPlan({
    ...base,
    status: allActivated ? "current" : "ready",
    disposition: allActivated
      ? "already_applied"
      : existingSameChange.length > 0
        ? "resume"
        : "materialize",
    steps,
    blockedReasons: [],
  });
}
