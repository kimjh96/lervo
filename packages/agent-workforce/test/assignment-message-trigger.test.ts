import { describe, expect, it } from "vitest";

import {
  assignmentMessageTriggerDescriptorHash,
  createAssignmentMentionRoutePlan,
  createAssignmentMessageTriggerPlan,
  type AssignmentMessageTriggerDescriptorV1,
  type WorkforceAgent,
  type WorkforceAssignment,
} from "../src/index.js";

const projectId = "prj_message_trigger_01";
const workstreamId = "wks_111111111111111111111111";
const fromAgentId = "agt_111111111111111111111111";
const toAgentId = "agt_222222222222222222222222";
const contentHash = `sha256:${"a".repeat(64)}`;

function descriptor(
  availability: AssignmentMessageTriggerDescriptorV1["availability"] = "available",
): AssignmentMessageTriggerDescriptorV1 {
  const material = {
    schemaVersion: 1 as const,
    adapterId: "lervo/reviewed-message-file",
    adapterVersion: "1.0.0",
    availability,
    sourceEvidence: "reviewed_input" as const,
    reviewBoundary: "exact_plan_apply" as const,
    replayProtection: "source_event_key" as const,
    externalIdentifiers: "excluded" as const,
    capabilities: ["direct_message.handoff"] as ["direct_message.handoff"],
  };
  return { ...material, descriptorHash: assignmentMessageTriggerDescriptorHash(material) };
}

function fixtures() {
  const agents: WorkforceAgent[] = [
    {
      schemaVersion: 1,
      agentId: fromAgentId,
      projectId,
      roleId: "developer",
      roleVersion: "1.0.0",
      roleContractHash: `sha256:${"b".repeat(64)}`,
      roleProfileHash: `sha256:${"c".repeat(64)}`,
      provider: "any",
      capabilityHash: `sha256:${"d".repeat(64)}`,
      skillIds: [],
      responsibilityPaths: [],
      parentAgentId: null,
      delegationDepth: 0,
      status: "active",
      revision: 1,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
    {
      schemaVersion: 1,
      agentId: toAgentId,
      projectId,
      roleId: "writer",
      roleVersion: "1.0.0",
      roleContractHash: `sha256:${"e".repeat(64)}`,
      roleProfileHash: `sha256:${"f".repeat(64)}`,
      provider: "any",
      capabilityHash: `sha256:${"1".repeat(64)}`,
      skillIds: [],
      responsibilityPaths: [],
      parentAgentId: null,
      delegationDepth: 0,
      status: "active",
      revision: 1,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
  ];
  const assignment: WorkforceAssignment = {
    schemaVersion: 1,
    assignmentId: "asn_111111111111111111111111",
    projectId,
    taskType: "implementation",
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: agents[0]!.roleContractHash,
    status: "leased",
    priority: 50,
    dependencyIds: [],
    acceptanceCriteria: [],
    verificationSuiteIds: [],
    approvalRequirements: [],
    expectedPaths: [],
    workstreamId,
    assigneeAgentId: fromAgentId,
    lease: {
      leaseId: "lse_111111111111111111111111",
      agentId: fromAgentId,
      sessionId: "ses_message_trigger_01",
      generation: 1,
      acquiredAt: "2026-09-05T00:00:00.000Z",
      expiresAt: "2026-09-05T00:10:00.000Z",
    },
    handoffs: [],
    resultArtifacts: [],
    failureCode: null,
    revision: 2,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  };
  const source = {
    schemaVersion: 1 as const,
    kind: "direct_message" as const,
    eventId: `cve_${"2".repeat(64)}`,
    sourceEventKeyHash: `sha256:${"3".repeat(64)}`,
    projectId,
    workstreamId,
    fromAgentId,
    toAgentId,
    content: { artifactId: "art_direct_message_01", contentHash },
    occurredAt: "2026-09-05T00:01:00.000Z",
  };
  const request = {
    schemaVersion: 1 as const,
    adapterId: descriptor().adapterId,
    assignmentId: assignment.assignmentId,
    leaseId: assignment.lease!.leaseId,
    source,
    contextEvidenceEventIds: [] as string[],
  };
  const routePlan = createAssignmentMentionRoutePlan({
    projectId,
    workstreamId,
    assignment,
    agents,
    sourceAllowedRoleIds: ["writer"],
    fromAgentId,
    leaseId: request.leaseId,
    target: { kind: "agent", agentId: toAgentId },
    requestDigest: contentHash,
    artifactReferences: [source.content],
    contextEvidenceEventIds: [],
    observedAt: "2026-09-05T00:02:00.000Z",
  });
  return { assignment, request, routePlan };
}

describe("reviewed direct-message trigger planning", () => {
  it("binds the reviewed adapter, message artifact, source event, and exact handoff plan", () => {
    const { assignment, request, routePlan } = fixtures();
    const plan = createAssignmentMessageTriggerPlan({
      request,
      descriptor: descriptor(),
      observation: request.source,
      routePlan,
      existingHandoffs: assignment.handoffs,
      observedAt: "2026-09-05T00:02:00.000Z",
    });

    expect(plan).toMatchObject({
      status: "ready",
      disposition: "record_handoff",
      sourceEventId: request.source.eventId,
      routePlanId: routePlan.planId,
      content: request.source.content,
      blockedReasons: [],
    });
  });

  it("returns current for exact replay and blocks conflicting reuse of a source event key", () => {
    const { request, routePlan } = fixtures();
    const currentDescriptor = descriptor();
    const trigger = {
      kind: "reviewed_direct_message" as const,
      adapterId: currentDescriptor.adapterId,
      adapterVersion: currentDescriptor.adapterVersion,
      descriptorHash: currentDescriptor.descriptorHash,
      sourceEventId: request.source.eventId,
      sourceEventKeyHash: request.source.sourceEventKeyHash,
    };
    const exact = {
      handoffId: "hnd_111111111111111111111111",
      fromAgentId,
      toAgentId,
      requestDigest: contentHash,
      artifactReferences: [request.source.content],
      contextEvidenceEventIds: [],
      createdAt: "2026-09-05T00:02:00.000Z",
      acknowledgedAt: null,
      trigger,
    };
    const current = createAssignmentMessageTriggerPlan({
      request,
      descriptor: currentDescriptor,
      observation: request.source,
      routePlan: { ...routePlan, status: "blocked", blockedReason: "source_lease_expired" },
      existingHandoffs: [exact],
      observedAt: "2026-09-05T00:20:00.000Z",
    });
    expect(current).toMatchObject({
      status: "current",
      disposition: "already_recorded",
      existingHandoffId: exact.handoffId,
    });

    const conflict = createAssignmentMessageTriggerPlan({
      request,
      descriptor: currentDescriptor,
      observation: request.source,
      routePlan,
      existingHandoffs: [{ ...exact, toAgentId: fromAgentId }],
      observedAt: "2026-09-05T00:02:00.000Z",
    });
    expect(conflict).toMatchObject({
      status: "blocked",
      blockedReasons: ["source_event_conflict"],
    });
  });

  it("blocks unavailable adapters and observations that differ from the reviewed source", () => {
    const { assignment, request, routePlan } = fixtures();
    const plan = createAssignmentMessageTriggerPlan({
      request,
      descriptor: descriptor("unavailable"),
      observation: { ...request.source, sourceEventKeyHash: `sha256:${"9".repeat(64)}` },
      routePlan,
      existingHandoffs: assignment.handoffs,
      observedAt: "2026-09-05T00:02:00.000Z",
    });

    expect(plan).toMatchObject({
      status: "blocked",
      blockedReasons: ["adapter_unavailable", "source_mismatch"],
    });
  });
});
