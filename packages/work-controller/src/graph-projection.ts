import type {
  ManagedAttemptObservationV1,
  WorkGraphNodeV1,
  WorkGraphV1,
} from "@lervo/application-contract";

import { sha256, shortId } from "./hash.js";

export interface AssignmentGraphSourceV1 {
  assignmentId: string;
  revision: number;
  projectId: string;
  taskType: string;
  roleId: string;
  status: WorkGraphNodeV1["status"];
  priority: number;
  dependencyIds: string[];
  approvalRequirements: string[];
  workstreamId: string | null;
  assigneeAgentId: string | null;
  lease: {
    leaseId: string;
    agentId: string;
    expiresAt: string;
  } | null;
}

function approvalDigest(requirement: string): string {
  return sha256(`lervo-approval-requirement-v1\0${requirement}`);
}

function graphValidity(
  nodes: readonly WorkGraphNodeV1[],
  attempts: readonly ManagedAttemptObservationV1[],
): string[] {
  const reasons = new Set<string>();
  const ids = new Set(nodes.map((node) => node.assignmentId));
  if (ids.size !== nodes.length) reasons.add("duplicate_assignment");
  for (const node of nodes) {
    if (node.dependencyIds.includes(node.assignmentId)) reasons.add("self_dependency");
    if (node.dependencyIds.some((dependencyId) => !ids.has(dependencyId))) {
      reasons.add("dependency_escape");
    }
  }
  if (attempts.some((attempt) => !ids.has(attempt.assignmentId))) {
    reasons.add("attempt_assignment_escape");
  }
  const byId = new Map(nodes.map((node) => [node.assignmentId, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (assignmentId: string): void => {
    if (visiting.has(assignmentId)) {
      reasons.add("dependency_cycle");
      return;
    }
    if (visited.has(assignmentId)) return;
    visiting.add(assignmentId);
    for (const dependencyId of byId.get(assignmentId)?.dependencyIds ?? []) visit(dependencyId);
    visiting.delete(assignmentId);
    visited.add(assignmentId);
  };
  for (const node of nodes) visit(node.assignmentId);
  return [...reasons].sort();
}

export function projectWorkGraph(input: {
  projectId: string;
  workstreamId: string;
  assignments: readonly AssignmentGraphSourceV1[];
  attempts: readonly ManagedAttemptObservationV1[];
  observedAt: string;
}): WorkGraphV1 {
  const observedAtMs = Date.parse(input.observedAt);
  if (!Number.isFinite(observedAtMs)) throw new TypeError("The graph observation time is invalid.");
  const nodes = input.assignments
    .filter((assignment) => assignment.workstreamId === input.workstreamId)
    .map<WorkGraphNodeV1>((assignment) => {
      const leaseState =
        assignment.lease === null
          ? ("none" as const)
          : Date.parse(assignment.lease.expiresAt) > observedAtMs
            ? ("active" as const)
            : ("expired" as const);
      return {
        assignmentId: assignment.assignmentId,
        assignmentRevision: assignment.revision,
        taskType: assignment.taskType,
        roleId: assignment.roleId,
        status: assignment.status,
        priority: assignment.priority,
        dependencyIds: [...assignment.dependencyIds].sort(),
        approvalRequirementDigests: assignment.approvalRequirements.map(approvalDigest).sort(),
        leaseState,
        assigneeAgentId: assignment.assigneeAgentId,
        leaseId: assignment.lease?.leaseId ?? null,
        attemptCount: input.attempts.filter(
          (attempt) => attempt.assignmentId === assignment.assignmentId,
        ).length,
      };
    })
    .sort((left, right) => left.assignmentId.localeCompare(right.assignmentId));
  const reasonCodes = graphValidity(nodes, input.attempts);
  const graphState = {
    schemaVersion: 1 as const,
    projectId: input.projectId,
    workstreamId: input.workstreamId,
    validity: {
      status: reasonCodes.length === 0 ? ("valid" as const) : ("invalid" as const),
      reasonCodes,
    },
    nodes,
    rootAssignmentIds: nodes
      .filter((node) => node.dependencyIds.length === 0)
      .map((node) => node.assignmentId),
    joinAssignmentIds: nodes
      .filter((node) => node.dependencyIds.length > 1)
      .map((node) => node.assignmentId),
  };
  return {
    ...graphState,
    observedAt: input.observedAt,
    graphId: shortId("wgr", { projectId: input.projectId, workstreamId: input.workstreamId }),
    graphHash: sha256(JSON.stringify(graphState)),
  };
}
