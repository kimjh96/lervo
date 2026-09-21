import { resolve } from "node:path";

import {
  deliberationExecutionRouteHash,
  workforceProviderPolicyHash,
} from "@lervo/agent-organization";
import { FileSystemCas } from "@lervo/cas";
import type { EventEnvelope } from "@lervo/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CoResidentConversationDeliberationParticipants } from "../src/conversation-deliberation-participant-router.js";
import type { NodeDiscordConversationConfig } from "../src/config-types.js";
import { removeTemporaryRoots, temporaryRoot } from "./fixture.js";

const projectId = "prj_deliberation01";
const organizationId = "org_lervoowner01";
const teamId = "team_project001";
const agentId = `agt_${"a".repeat(24)}`;
const participantId = "ptc_ruen_agent01";
const membershipId = "amem_ruen_agent01";
const deploymentId = "adep_ruen_agent01";
const channelMembershipId = "cmem_ruen_agent01";
const conversationId = "cnv_general0001";
const hash = (value: string) => `sha256:${value.repeat(64)}`;
const providerPolicyHash = workforceProviderPolicyHash("codex");
const role = {
  roleId: "product-owner",
  roleVersion: "1.0.0",
  roleContractHash: hash("2"),
  roleProfileHash: hash("3"),
  providerPolicyHash,
};

function event(seq: number, type: string, payload: unknown): EventEnvelope {
  return { projectId, seq, type, payload } as EventEnvelope;
}

function events(): EventEnvelope[] {
  const common = { organizationId, teamId, projectId };
  return [
    event(1, "organization.team.bound", {
      ...common,
      repositoryIdentityHash: hash("1"),
      organizationPolicyHash: hash("2"),
      teamPolicyHash: hash("3"),
      teamKind: "project",
      boundAt: "2026-09-18T00:00:00.000Z",
    }),
    event(2, "organization.agent.membership.changed", {
      ...common,
      membershipId,
      agentId,
      agentDisplayName: "Ruen",
      agentDisplayNameSource: "explicit",
      displayNameRevision: 1,
      ...role,
      previousStatus: null,
      status: "active",
      revision: 1,
      changedAt: "2026-09-18T00:00:01.000Z",
    }),
    event(3, "organization.external_agent.deployment.bound", {
      ...common,
      deploymentId,
      membershipId,
      agentId,
      agentDisplayName: "Ruen",
      agentDisplayNameSource: "explicit",
      displayNameRevision: 1,
      participantId,
      ...role,
      platform: "discord",
      integrationId: "itg_ruenagent01",
      externalPrincipalHash: hash("4"),
      deploymentConfigHash: hash("5"),
      boundAt: "2026-09-18T00:00:02.000Z",
    }),
    event(4, "organization.channel.membership.changed", {
      ...common,
      channelMembershipId,
      deploymentId,
      membershipId,
      agentId,
      participantId,
      platform: "discord",
      integrationId: "itg_ruenagent01",
      tenantKeyHash: hash("6"),
      conversationKeyHash: hash("7"),
      conversationId,
      previousStatus: null,
      status: "active",
      revision: 1,
      changedAt: "2026-09-18T00:00:03.000Z",
    }),
  ];
}

function config(): NodeDiscordConversationConfig {
  return {
    integrationId: "itg_ruenagent01",
    applicationId: "999999999999999991",
    botTokenFile: "/tmp/token",
    intents: 37_377,
    allowedGuildIds: ["123456789012345678"],
    allowDirectMessages: false,
    workerId: "ruen-worker",
    agentParticipantId: participantId,
    agentId,
    organization: { organizationId, teamId },
    conversations: [
      {
        tenantKey: "123456789012345678",
        conversationKey: "223456789012345678",
        conversationId,
      },
    ],
    participants: [],
    routing: {
      readOnlyRoleId: "conversation-reader",
      response: { provider: "codex", model: "gpt-5.6-terra", reasoningEffort: "medium" },
    },
    command: {
      roleId: "product-owner",
      provider: "codex",
      risk: "medium",
      verificationSuiteIds: ["repository.default.v4"],
      lifetimeMs: 300_000,
      assignmentId: null,
      agentId,
    },
    deliberationParticipation: {
      routes: [
        {
          policyId: "deliberation_architecture-review",
          policyRoleId: "technical-proposer",
          provider: "codex",
          model: "gpt-6-astra",
          reasoningEffort: "high",
        },
      ],
    },
  };
}

afterEach(removeTemporaryRoots);

describe("co-resident deliberation participant router", () => {
  it("accepts an explicit policy seat under the hired agent identity and publishes as that runtime", async () => {
    const source = events();
    const router = new CoResidentConversationDeliberationParticipants({
      events: {
        latest: () => source.at(-1) ?? null,
        list: (options) =>
          source.filter((item) => item.seq > (options?.afterSeq ?? 0)).slice(0, options?.limit),
      },
    });
    router.register({
      config: config(),
      participation: {
        agentId,
        displayName: "Ruen",
        roleId: "product-owner",
        agentBinding: {
          agentId,
          roleVersion: role.roleVersion,
          roleContractHash: role.roleContractHash,
          roleProfileHash: role.roleProfileHash,
        },
      },
    });
    const root = await temporaryRoot();
    const artifacts = await FileSystemCas.open(resolve(root, "artifacts"));
    const received: Array<unknown> = [];
    const deliver = vi.fn(async () => undefined);
    router.attach({
      participantId,
      artifacts,
      handle: async (inbound) => {
        received.push(inbound);
        return [{ result: { outbound: { outboundId: "cvo_test" } } }];
      },
      deliver,
    });
    const assignments = router.assign({
      deliberationId: "dlb_router0001",
      policyId: "deliberation_architecture-review",
      projectId,
      conversationId,
      acceptedAt: "2026-09-18T00:00:04.000Z",
    });
    expect(assignments).toEqual([
      expect.objectContaining({
        policyRoleId: "technical-proposer",
        agentRoleId: "product-owner",
        agentId,
        participantId,
        provider: "codex",
        model: "gpt-6-astra",
        reasoningEffort: "high",
      }),
    ]);
    expect(assignments[0]!.executionRouteHash).toBe(
      deliberationExecutionRouteHash({
        participantId,
        integrationId: "itg_ruenagent01",
        provider: "codex",
        model: "gpt-6-astra",
        reasoningEffort: "high",
      }),
    );
    expect(
      router.preflight({
        policyId: "deliberation_architecture-review",
        projectId,
        conversationId,
      }),
    ).toEqual({ participantIds: [participantId] });

    await router.publish({
      participantId,
      projectId,
      conversationId,
      threadId: null,
      replyToEventId: `cve_${"b".repeat(64)}`,
      artifactEventId: "evt_artifact0001",
      content: "**Technical proposer**\n\nAdopt the explicit route.",
      occurredAt: "2026-09-18T00:00:05.000Z",
    });
    expect(received).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({
          integrationId: "itg_ruenagent01",
          projectId,
          conversationId,
        }),
        mentions: { participantIds: [participantId], roleIds: [] },
        signalCode: "deliberation.artifact.recorded",
      }),
    ]);
    expect(deliver).toHaveBeenCalledWith("itg_ruenagent01");
  });

  it("does not invent a named participant when no runtime accepted the seat", () => {
    const source = events();
    const router = new CoResidentConversationDeliberationParticipants({
      events: {
        latest: () => source.at(-1) ?? null,
        list: (options) =>
          source.filter((item) => item.seq > (options?.afterSeq ?? 0)).slice(0, options?.limit),
      },
    });
    expect(
      router.assign({
        deliberationId: "dlb_router0001",
        policyId: "deliberation_architecture-review",
        projectId,
        conversationId,
        acceptedAt: "2026-09-18T00:00:04.000Z",
      }),
    ).toEqual([]);
  });

  it("fails closed while an accepted participant runtime is not attached", () => {
    const source = events();
    const router = new CoResidentConversationDeliberationParticipants({
      events: {
        latest: () => source.at(-1) ?? null,
        list: (options) =>
          source.filter((item) => item.seq > (options?.afterSeq ?? 0)).slice(0, options?.limit),
      },
    });
    router.register({
      config: config(),
      participation: {
        agentId,
        displayName: "Ruen",
        roleId: "product-owner",
        agentBinding: {
          agentId,
          roleVersion: role.roleVersion,
          roleContractHash: role.roleContractHash,
          roleProfileHash: role.roleProfileHash,
        },
      },
    });

    expect(() =>
      router.assign({
        deliberationId: "dlb_router0001",
        policyId: "deliberation_architecture-review",
        projectId,
        conversationId,
        acceptedAt: "2026-09-18T00:00:04.000Z",
      }),
    ).toThrowError("The accepted deliberation participant runtime is unavailable.");
  });
});
