import { createHash } from "node:crypto";
import { posix } from "node:path";

import type {
  AssignmentRoutineRequestV1,
  AssignmentRoutineTemplateNodeV1,
} from "@lervo/application-contract";

const HASH = /^sha256:[a-f0-9]{64}$/u;
export const assignmentRoutineProjectId = /^prj_[a-f0-9]{16}$/u;
export const assignmentRoutineWorkstreamId = /^wks_[a-f0-9]{24}$/u;
const ROUTINE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;

export function stableAssignmentRoutineJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableAssignmentRoutineJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableAssignmentRoutineJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function assignmentRoutineDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableAssignmentRoutineJson(value)).digest("hex")}`;
}

export function assignmentRoutineOpaqueId(
  prefix: "asn" | "rin" | "rplan",
  material: unknown,
): string {
  return `${prefix}_${assignmentRoutineDigest(material).slice("sha256:".length).slice(0, 24)}`;
}

function boundedStrings(values: unknown, maximum: number, pattern?: RegExp): values is string[] {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.length <= maximum &&
    values.every(
      (value) =>
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 1_024 &&
        (pattern === undefined || pattern.test(value)),
    ) &&
    new Set(values).size === values.length
  );
}

function safePath(value: string): boolean {
  return (
    value === "*" ||
    (value.length <= 1_024 &&
      posix.normalize(value) === value &&
      !value.startsWith("/") &&
      !value.includes("../") &&
      !value.includes("\\") &&
      !value.includes("\0"))
  );
}

function validNode(node: AssignmentRoutineTemplateNodeV1): boolean {
  return (
    ROUTINE_ID.test(node.nodeKey) &&
    node.nodeKey.length <= 100 &&
    /^[a-z][a-z0-9._-]{1,99}$/u.test(node.taskType) &&
    ROUTINE_ID.test(node.roleId) &&
    node.roleId.length <= 100 &&
    VERSION.test(node.roleVersion) &&
    HASH.test(node.roleContractHash) &&
    (node.requiredCapabilityHash === null || HASH.test(node.requiredCapabilityHash)) &&
    Number.isSafeInteger(node.priority) &&
    node.priority >= 0 &&
    node.priority <= 100 &&
    (node.dependencyNodeKeys.length === 0 ||
      boundedStrings(node.dependencyNodeKeys, 64, ROUTINE_ID)) &&
    boundedStrings(node.acceptanceCriteria, 32) &&
    boundedStrings(node.verificationSuiteIds, 32) &&
    (node.approvalRequirements.length === 0 || boundedStrings(node.approvalRequirements, 32)) &&
    boundedStrings(node.expectedPaths, 128) &&
    node.expectedPaths.every(safePath)
  );
}

function orderedNodes(nodes: AssignmentRoutineTemplateNodeV1[]): AssignmentRoutineTemplateNodeV1[] {
  const byKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  const remaining = new Set(byKey.keys());
  const emitted = new Set<string>();
  const ordered: AssignmentRoutineTemplateNodeV1[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((key) =>
        byKey.get(key)!.dependencyNodeKeys.every((dependency) => emitted.has(dependency)),
      )
      .sort();
    if (ready.length === 0)
      throw new TypeError("The assignment routine template contains a cycle.");
    for (const key of ready) {
      remaining.delete(key);
      emitted.add(key);
      ordered.push(byKey.get(key)!);
    }
  }
  return ordered;
}

export function validateAndOrderAssignmentRoutineRequest(
  request: AssignmentRoutineRequestV1,
): AssignmentRoutineTemplateNodeV1[] {
  const template = request.template;
  if (
    request.schemaVersion !== 1 ||
    !assignmentRoutineWorkstreamId.test(request.workstreamId) ||
    template.schemaVersion !== 1 ||
    !ROUTINE_ID.test(template.routineId) ||
    template.routineId.length > 100 ||
    !VERSION.test(template.templateVersion) ||
    !["skip_if_active", "coalesce_if_active", "enqueue_bounded"].includes(
      template.concurrency.mode,
    ) ||
    !Number.isSafeInteger(template.concurrency.maximumActiveInstances) ||
    template.concurrency.maximumActiveInstances < 1 ||
    template.concurrency.maximumActiveInstances > 16 ||
    (template.concurrency.mode !== "enqueue_bounded" &&
      template.concurrency.maximumActiveInstances !== 1) ||
    !Array.isArray(template.nodes) ||
    template.nodes.length === 0 ||
    template.nodes.length > 32
  )
    throw new TypeError("The assignment routine template coordinates are invalid.");
  const invalidNode = template.nodes.find((node) => !validNode(node));
  if (invalidNode !== undefined)
    throw new TypeError(`The assignment routine node ${invalidNode.nodeKey} is invalid.`);
  if (
    request.trigger.schemaVersion !== 1 ||
    request.trigger.kind !== "manual" ||
    !HASH.test(request.trigger.requestDigest) ||
    !HASH.test(request.trigger.idempotencyKey) ||
    !Number.isFinite(Date.parse(request.trigger.observedAt))
  )
    throw new TypeError("The assignment routine manual trigger is invalid.");
  const keys = new Set(template.nodes.map((node) => node.nodeKey));
  if (
    keys.size !== template.nodes.length ||
    template.nodes.some(
      (node) =>
        node.dependencyNodeKeys.includes(node.nodeKey) ||
        node.dependencyNodeKeys.some((dependency) => !keys.has(dependency)),
    )
  )
    throw new TypeError("The assignment routine dependency graph is invalid.");
  return orderedNodes(template.nodes);
}

export function assignmentRoutineMaterialization(
  node: AssignmentRoutineTemplateNodeV1,
  dependencyIds: string[],
) {
  return {
    taskType: node.taskType,
    roleId: node.roleId,
    roleVersion: node.roleVersion,
    roleContractHash: node.roleContractHash,
    requiredCapabilityHash: node.requiredCapabilityHash,
    priority: node.priority,
    dependencyIds,
    acceptanceDigest: assignmentRoutineDigest(node.acceptanceCriteria),
    verificationDigest: assignmentRoutineDigest([...node.verificationSuiteIds].sort()),
    approvalDigest: assignmentRoutineDigest([...node.approvalRequirements].sort()),
    expectedPathDigest: assignmentRoutineDigest([...node.expectedPaths].sort()),
  };
}
