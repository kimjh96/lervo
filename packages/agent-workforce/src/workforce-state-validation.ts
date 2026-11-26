import { validConvergenceProvenance } from "./assignment-convergence-state.js";
import {
  isAssignmentAmendmentCoordinate,
  repositoryPathScopesOverlap,
} from "@lervo/work-controller";
import {
  AgentWorkforceError,
  type WorkforceAgent,
  type WorkforceArtifactReference,
  type WorkforceHandoffTriggerProvenance,
  type WorkforceHandoff,
  type WorkforceAssignment,
} from "./types.js";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { validAgentDisplayName } from "./agent-display-identity.js";
import { workforceLimits } from "./limits.js";
import { validWorkforceRoutineProvenance } from "./assignment-routine-state.js";
import { validWorkforceTopologyProvenance } from "./assignment-topology-state.js";
import { validKnowledgeJobProvenance } from "./assignment-knowledge-job-state.js";
import { isAssignmentRecoveryCoordinate } from "@lervo/work-controller";

export const HASH = /^sha256:[a-f0-9]{64}$/u;

export const ROLE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

export const ROLE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;

export const AGENT_ID = /^agt_[a-f0-9]{24}$/u;

export const ASSIGNMENT_ID = /^asn_[a-f0-9]{24}$/u;

export const HANDOFF_ID = /^hnd_[a-f0-9]{24}$/u;

export const SESSION_ID = /^ses_[A-Za-z0-9_-]{8,128}$/u;

export const EVENT_ID = /^evt_[A-Za-z0-9_-]{8,128}$/u;

export const ARTIFACT_ID = /^art_[A-Za-z0-9_-]{8,128}$/u;

export const WORKSTREAM_ID = /^wks_[a-f0-9]{24}$/u;

export const CONVERSATION_EVENT_ID = /^cve_[a-f0-9]{64}$/u;

export const ADAPTER_ID = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u;

export const MAXIMUM_STATE_BYTES = 2 * 1024 * 1024;

export const MINIMUM_LEASE_MS = 5_000;

export const MAXIMUM_LEASE_MS = 30 * 60_000;

export const STALE_LOCK_MS = 60_000;

export function fail(
  code: ConstructorParameters<typeof AgentWorkforceError>[0],
  message: string,
  cause?: unknown,
): never {
  throw new AgentWorkforceError(code, message, cause === undefined ? undefined : { cause });
}

export function digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function id(prefix: "agt" | "asn" | "hnd" | "lse", material: unknown): string {
  return `${prefix}_${createHash("sha256").update(stableJson(material)).digest("hex").slice(0, 24)}`;
}

export function validTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function boundedStrings(
  value: unknown,
  maximum: number,
  pattern?: RegExp,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every(
      (item) =>
        typeof item === "string" &&
        item.length > 0 &&
        item.length <= 1_024 &&
        (pattern === undefined || pattern.test(item)),
    ) &&
    new Set(value).size === value.length
  );
}

export function safePath(value: string): boolean {
  return (
    value === "*" ||
    (value.length <= 1_024 &&
      value.length > 0 &&
      posix.normalize(value) === value &&
      !value.startsWith("/") &&
      !value.includes("../") &&
      !value.includes("\\") &&
      !value.includes("\0"))
  );
}

export function validAgent(agent: unknown, projectId: string): agent is WorkforceAgent {
  if (agent === null || typeof agent !== "object" || Array.isArray(agent)) return false;
  const value = agent as WorkforceAgent;
  return (
    value.schemaVersion === 1 &&
    AGENT_ID.test(value.agentId) &&
    value.projectId === projectId &&
    (value.displayName === undefined || validAgentDisplayName(value.displayName)) &&
    (value.displayNameSource === undefined ||
      ["explicit", "generated", "legacy_derived"].includes(value.displayNameSource)) &&
    ROLE_ID.test(value.roleId) &&
    value.roleId.length <= 100 &&
    (value.roleVersion === undefined || ROLE_VERSION.test(value.roleVersion)) &&
    (value.roleContractHash === undefined || HASH.test(value.roleContractHash)) &&
    HASH.test(value.roleProfileHash) &&
    HASH.test(value.capabilityHash) &&
    ["codex", "claude", "any"].includes(value.provider) &&
    boundedStrings(value.skillIds, 32) &&
    (value.capabilityPackages === undefined ||
      (Array.isArray(value.capabilityPackages) &&
        value.capabilityPackages.length <= 64 &&
        value.capabilityPackages.every(
          (item) =>
            item !== null &&
            typeof item === "object" &&
            /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u.test(item.capabilityId) &&
            ["skill", "mcp_server", "provider_plugin", "bundle"].includes(item.kind) &&
            ROLE_VERSION.test(item.version) &&
            HASH.test(item.contentHash) &&
            ["project", "user"].includes(item.sourceKind),
        ))) &&
    boundedStrings(value.responsibilityPaths, 64) &&
    value.responsibilityPaths.every(safePath) &&
    (value.parentAgentId === null || AGENT_ID.test(value.parentAgentId)) &&
    Number.isSafeInteger(value.delegationDepth) &&
    value.delegationDepth >= 0 &&
    value.delegationDepth <= workforceLimits.maximumDelegationDepth &&
    ["active", "suspended", "retired"].includes(value.status) &&
    (value.origin === undefined || value.origin === "team" || value.origin === "lervo") &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 1 &&
    validTime(value.createdAt) &&
    validTime(value.updatedAt)
  );
}

export function validArtifact(value: unknown): value is WorkforceArtifactReference {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ARTIFACT_ID.test((value as WorkforceArtifactReference).artifactId) &&
    HASH.test((value as WorkforceArtifactReference).contentHash)
  );
}

export function validHandoffTrigger(value: unknown): value is WorkforceHandoffTriggerProvenance {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as WorkforceHandoffTriggerProvenance;
  return (
    item.kind === "reviewed_direct_message" &&
    ADAPTER_ID.test(item.adapterId) &&
    item.adapterId.length <= 128 &&
    ROLE_VERSION.test(item.adapterVersion) &&
    HASH.test(item.descriptorHash) &&
    CONVERSATION_EVENT_ID.test(item.sourceEventId) &&
    HASH.test(item.sourceEventKeyHash)
  );
}

export function validHandoff(value: unknown): value is WorkforceHandoff {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as WorkforceHandoff;
  return (
    HANDOFF_ID.test(item.handoffId) &&
    AGENT_ID.test(item.fromAgentId) &&
    AGENT_ID.test(item.toAgentId) &&
    HASH.test(item.requestDigest) &&
    Array.isArray(item.artifactReferences) &&
    item.artifactReferences.length <= 32 &&
    item.artifactReferences.every(validArtifact) &&
    boundedStrings(item.contextEvidenceEventIds, 64, EVENT_ID) &&
    validTime(item.createdAt) &&
    (item.acknowledgedAt === null || validTime(item.acknowledgedAt)) &&
    (item.trigger === undefined || item.trigger === null || validHandoffTrigger(item.trigger))
  );
}

export function validAssignment(value: unknown, projectId: string): value is WorkforceAssignment {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as WorkforceAssignment;
  const lease = item.lease;
  return (
    item.schemaVersion === 1 &&
    ASSIGNMENT_ID.test(item.assignmentId) &&
    item.projectId === projectId &&
    /^[a-z][a-z0-9._-]{1,99}$/u.test(item.taskType) &&
    ROLE_ID.test(item.roleId) &&
    item.roleId.length <= 100 &&
    (item.roleVersion === undefined || ROLE_VERSION.test(item.roleVersion)) &&
    (item.roleContractHash === undefined || HASH.test(item.roleContractHash)) &&
    (item.requiredCapabilityHash === undefined ||
      item.requiredCapabilityHash === null ||
      HASH.test(item.requiredCapabilityHash)) &&
    (item.routine === undefined ||
      item.routine === null ||
      validWorkforceRoutineProvenance(item.routine)) &&
    (item.topology === undefined ||
      item.topology === null ||
      validWorkforceTopologyProvenance(item.topology)) &&
    (item.knowledgeJob === undefined ||
      item.knowledgeJob === null ||
      (validKnowledgeJobProvenance(item.knowledgeJob) &&
        item.workstreamId !== null &&
        item.routine == null &&
        item.topology == null)) &&
    (item.convergence == null ||
      (validConvergenceProvenance(item.convergence) &&
        item.knowledgeJob == null &&
        item.routine == null &&
        item.topology == null)) &&
    ["queued", "leased", "blocked", "completed", "failed", "cancelled"].includes(item.status) &&
    Number.isSafeInteger(item.priority) &&
    item.priority >= 0 &&
    item.priority <= 100 &&
    boundedStrings(item.dependencyIds, 64, ASSIGNMENT_ID) &&
    !item.dependencyIds.includes(item.assignmentId) &&
    boundedStrings(item.acceptanceCriteria, 32) &&
    boundedStrings(item.verificationSuiteIds, 32) &&
    boundedStrings(item.approvalRequirements, 32) &&
    boundedStrings(item.expectedPaths, 128) &&
    item.expectedPaths.every(safePath) &&
    (item.accessMode === undefined || ["read_only", "write"].includes(item.accessMode)) &&
    (item.accessMode !== "read_only" ||
      item.knowledgeJob != null ||
      item.convergence != null ||
      HASH.test(item.requiredCapabilityHash ?? "")) &&
    (item.workstreamId === null || WORKSTREAM_ID.test(item.workstreamId)) &&
    (item.assigneeAgentId === null || AGENT_ID.test(item.assigneeAgentId)) &&
    (item.lastLeaseGeneration === undefined ||
      (Number.isSafeInteger(item.lastLeaseGeneration) &&
        item.lastLeaseGeneration >= 1 &&
        item.lastLeaseGeneration >= (lease?.generation ?? 0))) &&
    (item.amendment === undefined || isAssignmentAmendmentCoordinate(item.amendment)) &&
    (item.recovery === undefined ||
      (isAssignmentRecoveryCoordinate(item.recovery) &&
        item.lastLeaseGeneration !== undefined &&
        item.lastLeaseGeneration >= item.recovery.predecessorLeaseGeneration)) &&
    (lease === null ||
      (/^lse_[a-f0-9]{24}$/u.test(lease.leaseId) &&
        AGENT_ID.test(lease.agentId) &&
        SESSION_ID.test(lease.sessionId) &&
        Number.isSafeInteger(lease.generation) &&
        lease.generation >= 1 &&
        validTime(lease.acquiredAt) &&
        validTime(lease.expiresAt))) &&
    Array.isArray(item.handoffs) &&
    item.handoffs.length <= 256 &&
    item.handoffs.every(validHandoff) &&
    Array.isArray(item.resultArtifacts) &&
    item.resultArtifacts.length <= 64 &&
    item.resultArtifacts.every(validArtifact) &&
    (item.failureCode === null || /^[a-z][a-z0-9_]{1,99}$/u.test(item.failureCode)) &&
    Number.isSafeInteger(item.revision) &&
    item.revision >= 1 &&
    validTime(item.createdAt) &&
    validTime(item.updatedAt)
  );
}

export function overlaps(left: string[], right: string[]): boolean {
  return left.some((a) => right.some((b) => repositoryPathScopesOverlap(a, b)));
}
