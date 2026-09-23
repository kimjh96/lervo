import { createHash } from "node:crypto";

import type { WorkforceAssignment, WorkforceAssignmentKnowledgeJobProvenance } from "./types.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const EVENT_ID = /^evt_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const CONVERSATION_EVENT_ID = /^cve_[a-f0-9]{64}$/u;
const JOB_ID = /^kjb_[a-f0-9]{24}$/u;
const AGENT_ID = /^agt_[a-f0-9]{24}$/u;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function validKnowledgeJobProvenance(
  value: unknown,
): value is WorkforceAssignmentKnowledgeJobProvenance {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as WorkforceAssignmentKnowledgeJobProvenance;
  return (
    item.contractVersion === 1 &&
    JOB_ID.test(item.jobId) &&
    EVENT_ID.test(item.completionEventId) &&
    HASH.test(item.completionEventHash) &&
    CONVERSATION_EVENT_ID.test(item.sourceConversationEventId) &&
    (item.sourceManifestHash === null || HASH.test(item.sourceManifestHash)) &&
    AGENT_ID.test(item.agentId)
  );
}

export function knowledgeJobAssignmentId(
  projectId: string,
  provenance: WorkforceAssignmentKnowledgeJobProvenance,
): string {
  const material = stableJson({ projectId, completionEventId: provenance.completionEventId });
  return `asn_${createHash("sha256").update(material).digest("hex").slice(0, 24)}`;
}

export function knowledgeJobAssignmentMatches(
  existing: WorkforceAssignment,
  expected: {
    taskType: string;
    roleId: string;
    roleVersion: string;
    roleContractHash: string;
    requiredCapabilityHash: string | null;
    knowledgeJob: WorkforceAssignmentKnowledgeJobProvenance;
    priority: number;
    dependencyIds: string[];
    acceptanceCriteria: string[];
    verificationSuiteIds: string[];
    approvalRequirements: string[];
    expectedPaths: string[];
    accessMode: "read_only" | "write";
    workstreamId: string;
  },
): boolean {
  return (
    existing.taskType === expected.taskType &&
    existing.roleId === expected.roleId &&
    existing.roleVersion === expected.roleVersion &&
    existing.roleContractHash === expected.roleContractHash &&
    (existing.requiredCapabilityHash ?? null) === expected.requiredCapabilityHash &&
    stableJson(existing.knowledgeJob ?? null) === stableJson(expected.knowledgeJob) &&
    existing.priority === expected.priority &&
    stableJson(existing.dependencyIds) === stableJson(expected.dependencyIds) &&
    stableJson(existing.acceptanceCriteria) === stableJson(expected.acceptanceCriteria) &&
    stableJson(existing.verificationSuiteIds) === stableJson(expected.verificationSuiteIds) &&
    stableJson(existing.approvalRequirements) === stableJson(expected.approvalRequirements) &&
    stableJson(existing.expectedPaths) === stableJson(expected.expectedPaths) &&
    (existing.accessMode ?? "write") === expected.accessMode &&
    existing.workstreamId === expected.workstreamId
  );
}

export function knowledgeJobAssignmentEventCoordinates(assignment: WorkforceAssignment) {
  return assignment.knowledgeJob === undefined || assignment.knowledgeJob === null
    ? {}
    : {
        knowledgeJobContractVersion: assignment.knowledgeJob.contractVersion,
        knowledgeJobId: assignment.knowledgeJob.jobId,
        knowledgeCompletionEventId: assignment.knowledgeJob.completionEventId,
        knowledgeCompletionEventHash: assignment.knowledgeJob.completionEventHash,
        knowledgeSourceConversationEventId: assignment.knowledgeJob.sourceConversationEventId,
        knowledgeSourceManifestHash: assignment.knowledgeJob.sourceManifestHash,
        knowledgeAgentId: assignment.knowledgeJob.agentId,
      };
}
