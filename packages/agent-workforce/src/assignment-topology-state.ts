import { createHash } from "node:crypto";
import { automaticTopologyReviewerDigest } from "@lervo/work-controller";

import type { WorkforceAssignment, WorkforceAssignmentTopologyProvenance } from "./types.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const CHANGE_ID = /^gtc_[a-f0-9]{24}$/u;
const PLAN_ID = /^gtp_[a-f0-9]{24}$/u;
const KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function validWorkforceTopologyProvenance(
  value: unknown,
): value is WorkforceAssignmentTopologyProvenance {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as WorkforceAssignmentTopologyProvenance;
  return (
    item.contractVersion === 2 &&
    CHANGE_ID.test(item.changeId) &&
    KEY.test(item.changeKey) &&
    item.changeKey.length <= 100 &&
    HASH.test(item.requestHash) &&
    PLAN_ID.test(item.planId) &&
    HASH.test(item.approvalHash) &&
    HASH.test(item.reviewerIdDigest) &&
    Number.isSafeInteger(item.expectedNodeCount) &&
    item.expectedNodeCount >= 1 &&
    item.expectedNodeCount <= 32 &&
    HASH.test(item.nodeSetHash) &&
    KEY.test(item.nodeKey) &&
    item.nodeKey.length <= 100 &&
    (item.policyReview === undefined ||
      (item.policyReview !== null &&
        typeof item.policyReview === "object" &&
        !Array.isArray(item.policyReview) &&
        item.reviewerIdDigest === automaticTopologyReviewerDigest &&
        Object.keys(item.policyReview).length === 3 &&
        item.policyReview.schemaVersion === 1 &&
        /^osd_[a-f0-9]{24}$/u.test(item.policyReview.decisionId) &&
        HASH.test(item.policyReview.reviewHash)))
  );
}

export function topologyAssignmentId(
  projectId: string,
  topology: WorkforceAssignmentTopologyProvenance,
): string {
  const material = stableJson({
    projectId,
    changeId: topology.changeId,
    nodeKey: topology.nodeKey,
  });
  return `asn_${createHash("sha256").update(material).digest("hex").slice(0, 24)}`;
}

export function topologyAssignmentMatches(
  existing: WorkforceAssignment,
  expected: {
    taskType: string;
    roleId: string;
    roleVersion: string;
    roleContractHash: string;
    requiredCapabilityHash: string | null;
    topology: WorkforceAssignmentTopologyProvenance;
    priority: number;
    dependencyIds: string[];
    acceptanceCriteria: string[];
    verificationSuiteIds: string[];
    approvalRequirements: string[];
    expectedPaths: string[];
    workstreamId: string;
  },
): boolean {
  const existingTopology = existing.topology;
  return (
    existing.taskType === expected.taskType &&
    existing.roleId === expected.roleId &&
    existing.roleVersion === expected.roleVersion &&
    existing.roleContractHash === expected.roleContractHash &&
    (existing.requiredCapabilityHash ?? null) === expected.requiredCapabilityHash &&
    existing.priority === expected.priority &&
    stableJson(existing.dependencyIds) === stableJson(expected.dependencyIds) &&
    stableJson(existing.acceptanceCriteria) === stableJson(expected.acceptanceCriteria) &&
    stableJson(existing.verificationSuiteIds) === stableJson(expected.verificationSuiteIds) &&
    stableJson(existing.approvalRequirements) === stableJson(expected.approvalRequirements) &&
    stableJson(existing.expectedPaths) === stableJson(expected.expectedPaths) &&
    existing.workstreamId === expected.workstreamId &&
    existingTopology !== undefined &&
    existingTopology !== null &&
    existingTopology.contractVersion === expected.topology.contractVersion &&
    existingTopology.changeId === expected.topology.changeId &&
    existingTopology.changeKey === expected.topology.changeKey &&
    existingTopology.requestHash === expected.topology.requestHash &&
    existingTopology.approvalHash === expected.topology.approvalHash &&
    existingTopology.reviewerIdDigest === expected.topology.reviewerIdDigest &&
    existingTopology.expectedNodeCount === expected.topology.expectedNodeCount &&
    existingTopology.nodeSetHash === expected.topology.nodeSetHash &&
    existingTopology.nodeKey === expected.topology.nodeKey &&
    stableJson(existingTopology.policyReview ?? null) ===
      stableJson(expected.topology.policyReview ?? null)
  );
}

export function topologyAssignmentEventCoordinates(assignment: WorkforceAssignment) {
  return {
    topologyContractVersion: assignment.topology?.contractVersion ?? null,
    topologyChangeId: assignment.topology?.changeId ?? null,
    topologyChangeKey: assignment.topology?.changeKey ?? null,
    topologyRequestHash: assignment.topology?.requestHash ?? null,
    topologyPlanId: assignment.topology?.planId ?? null,
    topologyApprovalHash: assignment.topology?.approvalHash ?? null,
    topologyReviewerIdDigest: assignment.topology?.reviewerIdDigest ?? null,
    topologyExpectedNodeCount: assignment.topology?.expectedNodeCount ?? null,
    topologyNodeSetHash: assignment.topology?.nodeSetHash ?? null,
    topologyNodeKey: assignment.topology?.nodeKey ?? null,
    ...(assignment.topology?.policyReview === undefined
      ? {}
      : {
          topologyPolicyReviewVersion: assignment.topology.policyReview.schemaVersion,
          topologyPolicyDecisionId: assignment.topology.policyReview.decisionId,
          topologyPolicyReviewHash: assignment.topology.policyReview.reviewHash,
        }),
  };
}
