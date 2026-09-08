import { describe, expect, it } from "vitest";

import {
  createAssignmentMentionRoutePlan,
  type AssignmentMentionTarget,
  type WorkforceAgent,
  type WorkforceAssignment,
} from "../src/index.js";

const projectId = "prj_mention001";
const workstreamId = "wks_111111111111111111111111";
const sourceId = "agt_111111111111111111111111";
const recipientId = "agt_222222222222222222222222";
const managerId = "agt_333333333333333333333333";
const assignmentId = "asn_111111111111111111111111";
const leaseId = "lse_111111111111111111111111";

function agent(
  agentId: string,
  roleId: string,
  options: Partial<WorkforceAgent> = {},
): WorkforceAgent {
  return {
    schemaVersion: 1,
    agentId,
    projectId,
    displayName: `Agent-${agentId.slice(-4)}`,
    displayNameSource: "generated",
    roleId,
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${"a".repeat(64)}`,
    roleProfileHash: `sha256:${"b".repeat(64)}`,
    provider: "any",
    capabilityHash: `sha256:${"c".repeat(64)}`,
    skillIds: [],
    responsibilityPaths: ["*"],
    parentAgentId: null,
    delegationDepth: 0,
    status: "active",
    revision: 1,
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    ...options,
  };
}

function assignment(options: Partial<WorkforceAssignment> = {}): WorkforceAssignment {
  return {
    schemaVersion: 1,
    assignmentId,
    projectId,
    taskType: "implementation",
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${"a".repeat(64)}`,
    status: "leased",
    priority: 50,
    dependencyIds: [],
    acceptanceCriteria: ["Route one exact mention."],
    verificationSuiteIds: ["test"],
    approvalRequirements: [],
    expectedPaths: ["packages/agent-workforce"],
    workstreamId,
    assigneeAgentId: sourceId,
    lease: {
      leaseId,
      agentId: sourceId,
      sessionId: "ses_111111111111111111111111",
      generation: 1,
      acquiredAt: "2026-09-02T00:00:00.000Z",
      expiresAt: "2026-09-02T00:10:00.000Z",
    },
    handoffs: [],
    resultArtifacts: [],
    failureCode: null,
    revision: 2,
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    ...options,
  };
}

function plan(
  target: AssignmentMentionTarget,
  agents: WorkforceAgent[],
  observedAt?: string,
  sourceAllowedRoleIds = ["researcher"],
) {
  return createAssignmentMentionRoutePlan({
    projectId,
    workstreamId,
    assignment: assignment(),
    agents,
    sourceAllowedRoleIds,
    fromAgentId: sourceId,
    leaseId,
    target,
    requestDigest: `sha256:${"d".repeat(64)}`,
    artifactReferences: [
      { artifactId: "art_mention0001", contentHash: `sha256:${"e".repeat(64)}` },
    ],
    contextEvidenceEventIds: ["evt_mention0001"],
    observedAt: observedAt ?? "2026-09-02T00:01:00.000Z",
  });
}

describe("assignment mention routing", () => {
  it("resolves one exact active agent without granting delivery or task authority", () => {
    const source = agent(sourceId, "developer", { parentAgentId: managerId });
    const recipient = agent(recipientId, "researcher");
    const first = plan({ kind: "agent", agentId: recipientId }, [source, recipient]);
    const later = plan(
      { kind: "agent", agentId: recipientId },
      [recipient, source],
      "2026-09-02T00:02:00.000Z",
    );

    expect(first).toMatchObject({
      status: "ready",
      recipientAgentId: recipientId,
      blockedReason: null,
      planId: expect.stringMatching(/^amrp_[a-f0-9]{24}$/u),
    });
    expect(later.planId).toBe(first.planId);
    expect(first.sourceHandoffPolicyHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(
      plan(
        { kind: "agent", agentId: recipientId },
        [source, recipient],
        "2026-09-02T00:01:00.000Z",
        ["researcher", "writer"],
      ).planId,
    ).not.toBe(first.planId);
  });

  it("resolves manager ancestry and one exact role candidate", () => {
    const source = agent(sourceId, "developer", { parentAgentId: managerId });
    const manager = agent(managerId, "researcher");
    expect(plan({ kind: "manager" }, [source, manager]).recipientAgentId).toBe(managerId);
    expect(plan({ kind: "role", roleId: "researcher" }, [manager, source]).recipientAgentId).toBe(
      managerId,
    );
  });

  it("keeps ambiguous, inactive, self, and disallowed recipients blocked", () => {
    const source = agent(sourceId, "developer");
    const first = agent(recipientId, "researcher");
    const second = agent(managerId, "researcher");
    expect(plan({ kind: "role", roleId: "researcher" }, [source, first, second])).toMatchObject({
      status: "blocked",
      blockedReason: "mention_ambiguous",
      candidateAgentIds: [recipientId, managerId].sort(),
    });
    expect(
      plan({ kind: "agent", agentId: recipientId }, [
        source,
        agent(recipientId, "researcher", { status: "retired" }),
      ]),
    ).toMatchObject({ blockedReason: "mention_inactive" });
    expect(plan({ kind: "agent", agentId: sourceId }, [source])).toMatchObject({
      blockedReason: "self_recipient",
    });
    expect(plan({ kind: "reviewer" }, [source, agent(recipientId, "reviewer")])).toMatchObject({
      blockedReason: "recipient_role_not_allowed",
    });
  });

  it("rechecks exact lease time and does not turn expiry into routing success", () => {
    const source = agent(sourceId, "developer");
    const recipient = agent(recipientId, "researcher");
    expect(
      plan(
        { kind: "agent", agentId: recipientId },
        [source, recipient],
        "2026-09-02T00:10:00.000Z",
      ),
    ).toMatchObject({ status: "blocked", blockedReason: "source_lease_expired" });
  });
});
