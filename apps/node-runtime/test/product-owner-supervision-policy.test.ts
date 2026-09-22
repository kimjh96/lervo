import { describe, expect, it } from "vitest";

import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "../src/config-types.js";
import type { DiscordAgentParticipation } from "../src/discord-agent-participation.js";
import { assertProductOwnerSupervisionPolicy } from "../src/product-owner-supervision-policy.js";

const ownerAgentId = `agt_${"1".repeat(24)}`;

function deployment(
  agentId = ownerAgentId,
  acceptsSupervisionGoals = true,
): NodeDiscordConversationConfig {
  return {
    agentId,
    policy: { acceptsSupervisionGoals },
  } as NodeDiscordConversationConfig;
}

function participation(
  roleId = "product-owner",
  agentId: string | null = ownerAgentId,
): DiscordAgentParticipation {
  return { agentId, displayName: "Owner", roleId };
}

function config(ownerId = ownerAgentId): NodeRuntimeConfig {
  return {
    outcomeSupervision: { binding: { ownerAgentId: ownerId } },
  } as NodeRuntimeConfig;
}

describe("product-owner supervision policy", () => {
  it("requires an exact installed goal route for the one deployed product owner", () => {
    expect(() =>
      assertProductOwnerSupervisionPolicy({
        config: config(),
        deployments: [deployment()],
        participations: [participation()],
      }),
    ).not.toThrow();

    for (const candidate of [
      { config: {} as NodeRuntimeConfig, deployment: deployment() },
      { config: config(), deployment: deployment(ownerAgentId, false) },
      { config: config(`agt_${"2".repeat(24)}`), deployment: deployment() },
    ]) {
      expect(() =>
        assertProductOwnerSupervisionPolicy({
          config: candidate.config,
          deployments: [candidate.deployment],
          participations: [participation()],
        }),
      ).toThrow("requires its exact installed supervision binding and goal intake");
    }
  });

  it("does not grant supervision to non-product-owner deployments", () => {
    expect(() =>
      assertProductOwnerSupervisionPolicy({
        config: {} as NodeRuntimeConfig,
        deployments: [deployment()],
        participations: [participation("developer")],
      }),
    ).not.toThrow();
  });

  it("rejects more than one deployed product owner because one Node has one binding", () => {
    expect(() =>
      assertProductOwnerSupervisionPolicy({
        config: config(),
        deployments: [deployment(), deployment(`agt_${"3".repeat(24)}`)],
        participations: [participation(), participation("product-owner", `agt_${"3".repeat(24)}`)],
      }),
    ).toThrow("exactly one deployed product owner");
  });
});
