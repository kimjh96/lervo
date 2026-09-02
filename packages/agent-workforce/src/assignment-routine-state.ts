import { createHash } from "node:crypto";

import type { WorkforceAssignment, WorkforceAssignmentRoutineProvenance } from "./types.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ROUTINE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const INVOCATION_ID = /^rin_[a-f0-9]{24}$/u;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function validWorkforceRoutineProvenance(
  value: unknown,
): value is WorkforceAssignmentRoutineProvenance {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as WorkforceAssignmentRoutineProvenance;
  return (
    ROUTINE_ID.test(item.routineId) &&
    item.routineId.length <= 100 &&
    VERSION.test(item.templateVersion) &&
    HASH.test(item.templateHash) &&
    INVOCATION_ID.test(item.invocationId) &&
    item.triggerKind === "manual" &&
    HASH.test(item.triggerDigest) &&
    ROUTINE_ID.test(item.nodeKey) &&
    item.nodeKey.length <= 100
  );
}

export function routineAssignmentId(
  projectId: string,
  routine: WorkforceAssignmentRoutineProvenance,
): string {
  const material = stableJson({
    projectId,
    invocationId: routine.invocationId,
    nodeKey: routine.nodeKey,
  });
  return `asn_${createHash("sha256").update(material).digest("hex").slice(0, 24)}`;
}

export function routineAssignmentMatches(
  existing: WorkforceAssignment,
  expected: {
    taskType: string;
    roleId: string;
    roleVersion: string;
    roleContractHash: string;
    requiredCapabilityHash: string | null;
    routine: WorkforceAssignmentRoutineProvenance;
    priority: number;
    dependencyIds: string[];
    acceptanceCriteria: string[];
    verificationSuiteIds: string[];
    approvalRequirements: string[];
    expectedPaths: string[];
    workstreamId: string;
  },
): boolean {
  return (
    existing.taskType === expected.taskType &&
    existing.roleId === expected.roleId &&
    existing.roleVersion === expected.roleVersion &&
    existing.roleContractHash === expected.roleContractHash &&
    (existing.requiredCapabilityHash ?? null) === expected.requiredCapabilityHash &&
    stableJson(existing.routine ?? null) === stableJson(expected.routine) &&
    existing.priority === expected.priority &&
    stableJson(existing.dependencyIds) === stableJson(expected.dependencyIds) &&
    stableJson(existing.acceptanceCriteria) === stableJson(expected.acceptanceCriteria) &&
    stableJson(existing.verificationSuiteIds) === stableJson(expected.verificationSuiteIds) &&
    stableJson(existing.approvalRequirements) === stableJson(expected.approvalRequirements) &&
    stableJson(existing.expectedPaths) === stableJson(expected.expectedPaths) &&
    existing.workstreamId === expected.workstreamId
  );
}

export function routineAssignmentEventCoordinates(assignment: WorkforceAssignment) {
  return {
    requiredCapabilityHash: assignment.requiredCapabilityHash ?? null,
    routineId: assignment.routine?.routineId ?? null,
    routineTemplateVersion: assignment.routine?.templateVersion ?? null,
    routineTemplateHash: assignment.routine?.templateHash ?? null,
    routineInvocationId: assignment.routine?.invocationId ?? null,
    routineTriggerKind: assignment.routine?.triggerKind ?? null,
    routineTriggerDigest: assignment.routine?.triggerDigest ?? null,
    routineNodeKey: assignment.routine?.nodeKey ?? null,
  };
}
