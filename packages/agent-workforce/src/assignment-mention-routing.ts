import { createHash } from "node:crypto";

import type { WorkforceAgent, WorkforceArtifactReference, WorkforceAssignment } from "./types.js";

export type AssignmentMentionTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "role"; roleId: string }
  | { kind: "manager" }
  | { kind: "reviewer" }
  | { kind: "verifier" };

export type AssignmentMentionRouteBlockedReason =
  | "assignment_scope_mismatch"
  | "source_agent_not_found"
  | "source_agent_inactive"
  | "source_lease_mismatch"
  | "source_lease_expired"
  | "mention_not_found"
  | "mention_inactive"
  | "mention_ambiguous"
  | "self_recipient"
  | "recipient_role_not_allowed";

export interface AssignmentMentionRoutePlan {
  schemaVersion: 1;
  planId: string;
  status: "ready" | "blocked";
  projectId: string;
  workstreamId: string;
  assignmentId: string;
  assignmentRevision: number;
  fromAgentId: string;
  sourceRoleVersion: string | null;
  sourceRoleContractHash: string | null;
  sourceHandoffPolicyHash: string;
  leaseId: string;
  target: AssignmentMentionTarget;
  candidateAgentIds: string[];
  recipientAgentId: string | null;
  recipientRoleId: string | null;
  recipientRoleVersion: string | null;
  recipientRoleContractHash: string | null;
  requestDigest: string;
  artifactReferences: WorkforceArtifactReference[];
  contextEvidenceEventIds: string[];
  observedAt: string;
  blockedReason: AssignmentMentionRouteBlockedReason | null;
}

const AGENT_ID = /^agt_[a-f0-9]{24}$/u;
const ASSIGNMENT_ID = /^asn_[a-f0-9]{24}$/u;
const LEASE_ID = /^lse_[a-f0-9]{24}$/u;
const ROLE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const ARTIFACT_ID = /^art_[A-Za-z0-9_-]{8,128}$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_-]{8,128}$/u;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function assertInput(input: {
  assignment: WorkforceAssignment;
  agents: readonly WorkforceAgent[];
  sourceAllowedRoleIds: readonly string[];
  fromAgentId: string;
  leaseId: string;
  target: AssignmentMentionTarget;
  requestDigest: string;
  artifactReferences: readonly WorkforceArtifactReference[];
  contextEvidenceEventIds: readonly string[];
  observedAt: string;
}): void {
  const targetValid =
    (input.target.kind === "agent" && AGENT_ID.test(input.target.agentId)) ||
    (input.target.kind === "role" && ROLE_ID.test(input.target.roleId)) ||
    ["manager", "reviewer", "verifier"].includes(input.target.kind);
  if (
    !ASSIGNMENT_ID.test(input.assignment.assignmentId) ||
    !AGENT_ID.test(input.fromAgentId) ||
    !LEASE_ID.test(input.leaseId) ||
    !targetValid ||
    !HASH.test(input.requestDigest) ||
    !Number.isFinite(Date.parse(input.observedAt)) ||
    input.agents.length > 1_024 ||
    input.artifactReferences.length > 64 ||
    input.contextEvidenceEventIds.length > 64 ||
    input.sourceAllowedRoleIds.length > 64 ||
    input.artifactReferences.some(
      (item) => !ARTIFACT_ID.test(item.artifactId) || !HASH.test(item.contentHash),
    ) ||
    input.contextEvidenceEventIds.some((eventId) => !EVENT_ID.test(eventId)) ||
    input.sourceAllowedRoleIds.some((roleId) => !ROLE_ID.test(roleId)) ||
    sortedUnique(input.contextEvidenceEventIds).length !== input.contextEvidenceEventIds.length ||
    sortedUnique(input.sourceAllowedRoleIds).length !== input.sourceAllowedRoleIds.length
  ) {
    throw new TypeError("The assignment mention route input is invalid or exceeds its bounds.");
  }
}

function mentionedAgents(input: {
  target: AssignmentMentionTarget;
  source: WorkforceAgent | undefined;
  agents: readonly WorkforceAgent[];
}): { candidates: WorkforceAgent[]; inactiveOnly: boolean } {
  const roleId =
    input.target.kind === "role"
      ? input.target.roleId
      : input.target.kind === "reviewer" || input.target.kind === "verifier"
        ? input.target.kind
        : null;
  let all: WorkforceAgent[];
  if (input.target.kind === "agent") {
    const agentId = input.target.agentId;
    all = input.agents.filter((agent) => agent.agentId === agentId);
  } else if (input.target.kind === "manager") {
    all = input.agents.filter((agent) => agent.agentId === input.source?.parentAgentId);
  } else {
    all = input.agents.filter((agent) => agent.roleId === roleId);
  }
  const active = all.filter((agent) => agent.status === "active");
  return { candidates: active, inactiveOnly: all.length > 0 && active.length === 0 };
}

export function createAssignmentMentionRoutePlan(input: {
  projectId: string;
  workstreamId: string;
  assignment: WorkforceAssignment;
  agents: readonly WorkforceAgent[];
  sourceAllowedRoleIds: readonly string[];
  fromAgentId: string;
  leaseId: string;
  target: AssignmentMentionTarget;
  requestDigest: string;
  artifactReferences: readonly WorkforceArtifactReference[];
  contextEvidenceEventIds: readonly string[];
  observedAt: string;
}): AssignmentMentionRoutePlan {
  assertInput(input);
  const agents = [...input.agents].sort((left, right) => left.agentId.localeCompare(right.agentId));
  const source = agents.find((agent) => agent.agentId === input.fromAgentId);
  const mention = mentionedAgents({ target: input.target, source, agents });
  const candidateAgentIds = mention.candidates.map((agent) => agent.agentId);
  const candidate = mention.candidates.length === 1 ? mention.candidates[0]! : null;
  const lease = input.assignment.lease;
  const blockedReason: AssignmentMentionRouteBlockedReason | null =
    input.assignment.projectId !== input.projectId ||
    input.assignment.workstreamId !== input.workstreamId
      ? "assignment_scope_mismatch"
      : source === undefined
        ? "source_agent_not_found"
        : source.status !== "active"
          ? "source_agent_inactive"
          : input.assignment.status !== "leased" ||
              lease === null ||
              lease.agentId !== input.fromAgentId ||
              lease.leaseId !== input.leaseId
            ? "source_lease_mismatch"
            : Date.parse(lease.expiresAt) <= Date.parse(input.observedAt)
              ? "source_lease_expired"
              : mention.inactiveOnly
                ? "mention_inactive"
                : mention.candidates.length === 0
                  ? "mention_not_found"
                  : mention.candidates.length > 1
                    ? "mention_ambiguous"
                    : candidate?.agentId === input.fromAgentId
                      ? "self_recipient"
                      : !input.sourceAllowedRoleIds.includes(candidate!.roleId)
                        ? "recipient_role_not_allowed"
                        : null;
  const content = {
    schemaVersion: 1 as const,
    status: blockedReason === null ? ("ready" as const) : ("blocked" as const),
    projectId: input.projectId,
    workstreamId: input.workstreamId,
    assignmentId: input.assignment.assignmentId,
    assignmentRevision: input.assignment.revision,
    fromAgentId: input.fromAgentId,
    sourceRoleVersion: source?.roleVersion ?? null,
    sourceRoleContractHash: source?.roleContractHash ?? null,
    sourceHandoffPolicyHash: `sha256:${createHash("sha256")
      .update(
        `lervo-assignment-mention-handoff-policy-v1\0${stableJson([...input.sourceAllowedRoleIds].sort())}`,
      )
      .digest("hex")}`,
    leaseId: input.leaseId,
    target: structuredClone(input.target),
    candidateAgentIds,
    recipientAgentId: blockedReason === null ? candidate!.agentId : null,
    recipientRoleId: blockedReason === null ? candidate!.roleId : null,
    recipientRoleVersion: blockedReason === null ? candidate!.roleVersion : null,
    recipientRoleContractHash: blockedReason === null ? candidate!.roleContractHash : null,
    requestDigest: input.requestDigest,
    artifactReferences: [...input.artifactReferences]
      .map((item) => ({ ...item }))
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    contextEvidenceEventIds: sortedUnique(input.contextEvidenceEventIds),
    observedAt: input.observedAt,
    blockedReason,
  };
  const { observedAt: _observedAt, ...planMaterial } = content;
  const planId = `amrp_${createHash("sha256")
    .update(stableJson(planMaterial))
    .digest("hex")
    .slice(0, 24)}`;
  return { ...content, planId };
}
