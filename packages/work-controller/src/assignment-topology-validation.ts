import { posix } from "node:path";

import type {
  AssignmentTopologyChangeRequestV2,
  AssignmentTopologyNodeV2,
} from "@lervo/application-contract";

import { sha256 } from "./hash.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ASSIGNMENT_ID = /^asn_[a-f0-9]{24}$/u;
const ROLE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const CHANGE_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

export const assignmentTopologyLimits = {
  maximumAddedNodes: 32,
  maximumGraphNodes: 256,
  maximumDependencies: 64,
} as const;

export function stableAssignmentTopologyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableAssignmentTopologyJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableAssignmentTopologyJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function assignmentTopologyDigest(value: unknown): string {
  return sha256(stableAssignmentTopologyJson(value));
}

export function assignmentTopologyId(prefix: "asn" | "gtc" | "gtp", material: unknown): string {
  return `${prefix}_${assignmentTopologyDigest(material).slice("sha256:".length).slice(0, 24)}`;
}

function boundedStrings(
  values: unknown,
  maximum: number,
  options: { allowEmpty?: boolean; pattern?: RegExp } = {},
): values is string[] {
  return (
    Array.isArray(values) &&
    (options.allowEmpty === true || values.length > 0) &&
    values.length <= maximum &&
    values.every(
      (value) =>
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 1_024 &&
        (options.pattern === undefined || options.pattern.test(value)),
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

function validNode(node: AssignmentTopologyNodeV2): boolean {
  return (
    CHANGE_KEY.test(node.nodeKey) &&
    node.nodeKey.length <= 100 &&
    /^[a-z][a-z0-9._-]{1,99}$/u.test(node.taskType) &&
    ROLE_ID.test(node.roleId) &&
    node.roleId.length <= 100 &&
    VERSION.test(node.roleVersion) &&
    HASH.test(node.roleContractHash) &&
    (node.requiredCapabilityHash === null || HASH.test(node.requiredCapabilityHash)) &&
    Number.isSafeInteger(node.priority) &&
    node.priority >= 0 &&
    node.priority <= 100 &&
    boundedStrings(node.dependencyAssignmentIds, assignmentTopologyLimits.maximumDependencies, {
      allowEmpty: true,
      pattern: ASSIGNMENT_ID,
    }) &&
    boundedStrings(node.dependencyNodeKeys, assignmentTopologyLimits.maximumDependencies, {
      allowEmpty: true,
      pattern: CHANGE_KEY,
    }) &&
    node.dependencyAssignmentIds.length + node.dependencyNodeKeys.length <=
      assignmentTopologyLimits.maximumDependencies &&
    boundedStrings(node.acceptanceCriteria, 32) &&
    boundedStrings(node.verificationSuiteIds, 32) &&
    boundedStrings(node.approvalRequirements, 32, { allowEmpty: true }) &&
    boundedStrings(node.expectedPaths, 128) &&
    node.expectedPaths.every(safePath)
  );
}

function orderedNodes(nodes: AssignmentTopologyNodeV2[]): AssignmentTopologyNodeV2[] {
  const byKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  const remaining = new Set(byKey.keys());
  const emitted = new Set<string>();
  const ordered: AssignmentTopologyNodeV2[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((key) => byKey.get(key)!.dependencyNodeKeys.every((item) => emitted.has(item)))
      .sort();
    if (ready.length === 0) throw new TypeError("The topology change contains a dependency cycle.");
    for (const key of ready) {
      remaining.delete(key);
      emitted.add(key);
      ordered.push(byKey.get(key)!);
    }
  }
  return ordered;
}

export function validateAndOrderAssignmentTopologyRequest(
  request: AssignmentTopologyChangeRequestV2,
): AssignmentTopologyNodeV2[] {
  if (
    request.schemaVersion !== 2 ||
    request.kind !== "assignment_topology.change" ||
    !/^wks_[a-f0-9]{24}$/u.test(request.workstreamId) ||
    !HASH.test(request.expectedGraphHash) ||
    !CHANGE_KEY.test(request.changeKey) ||
    request.changeKey.length > 100 ||
    !Array.isArray(request.nodes) ||
    request.nodes.length === 0 ||
    request.nodes.length > assignmentTopologyLimits.maximumAddedNodes ||
    request.nodes.some((node) => !validNode(node))
  ) {
    throw new TypeError("The assignment topology change coordinates are invalid.");
  }
  const keys = new Set(request.nodes.map((node) => node.nodeKey));
  if (
    keys.size !== request.nodes.length ||
    request.nodes.some(
      (node) =>
        node.dependencyNodeKeys.includes(node.nodeKey) ||
        node.dependencyNodeKeys.some((dependency) => !keys.has(dependency)),
    )
  ) {
    throw new TypeError("The assignment topology node dependencies are invalid.");
  }
  return orderedNodes(request.nodes);
}

export function assignmentTopologyMaterialization(
  node: AssignmentTopologyNodeV2,
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
    acceptanceDigest: assignmentTopologyDigest(node.acceptanceCriteria),
    verificationDigest: assignmentTopologyDigest([...node.verificationSuiteIds].sort()),
    approvalDigest: assignmentTopologyDigest([...node.approvalRequirements].sort()),
    expectedPathDigest: assignmentTopologyDigest([...node.expectedPaths].sort()),
  };
}
