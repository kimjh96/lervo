import { describe, expect, it } from "vitest";

import type { CeoCommandRequest, CeoPolicy } from "@lervo/application-contract";

import { createOrganizationOperatingReport, decideCeoCommand } from "../src/index.js";

const agentId = `agt_${"a".repeat(24)}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const policy: CeoPolicy = {
  schemaVersion: 1,
  policyId: "ceop_lervoowner01",
  organizationId: "org_lervo0001",
  appointedAgentId: agentId,
  allowedActions: ["agent.hire", "conversation.channel.create", "deliberation.convene"],
  approvalRequiredActions: ["conversation.channel.create"],
  allowedTeamIds: ["team_central0001", "team_project0001"],
  maximumAutomationDepth: 2,
  budgetPolicyHash: hash("b"),
};
const organization = createOrganizationOperatingReport({
  organizationId: policy.organizationId,
  teams: [
    {
      organizationId: policy.organizationId,
      teamId: "team_central0001",
      teamKind: "central",
      projectId: "prj_central0001",
      repositoryIdentityHash: hash("c"),
      membershipCounts: { active: 1, suspended: 0, ended: 0 },
      deploymentCounts: { active: 1, retired: 0 },
      activeChannelMembershipCount: 1,
      activeDeliberationCount: 0,
      activeAgentContextEntryCount: 0,
      currentWorkstream: null,
      sourceHeadSequence: 20,
    },
  ],
});

function request(overrides: Partial<CeoCommandRequest> = {}): CeoCommandRequest {
  return {
    schemaVersion: 1,
    requestId: "ceor_request0001",
    organizationId: policy.organizationId,
    requestedByAgentId: agentId,
    action: "agent.hire",
    teamId: "team_project0001",
    risk: "low",
    automationDepth: 1,
    budget: { status: "within", policyHash: policy.budgetPolicyHash },
    approvalId: null,
    ...overrides,
  };
}

describe("CEO policy", () => {
  it("allows only the appointed agent within team, automation, and observed budget bounds", () => {
    expect(decideCeoCommand({ policy, request: request(), organization })).toMatchObject({
      status: "allowed",
      reason: "policy_allows",
    });
    expect(
      decideCeoCommand({
        policy,
        request: request({ budget: { status: "unknown", policyHash: policy.budgetPolicyHash } }),
        organization,
      }),
    ).toMatchObject({ status: "denied", reason: "budget_unknown" });
  });

  it("keeps approval and organization conflicts distinct from role authority", () => {
    expect(
      decideCeoCommand({
        policy,
        request: request({ action: "conversation.channel.create" }),
        organization,
      }),
    ).toMatchObject({ status: "approval_required", reason: "approval_missing" });
    expect(
      decideCeoCommand({
        policy,
        request: request({ requestedByAgentId: `agt_${"d".repeat(24)}` }),
        organization,
      }),
    ).toMatchObject({ status: "denied", reason: "appointment_mismatch" });
  });

  it("rejects a tampered operating projection before authority evaluation", () => {
    expect(() =>
      decideCeoCommand({
        policy,
        request: request(),
        organization: { ...organization, status: "conflict" },
      }),
    ).toThrow("organization operating report contract is invalid");
  });
});
