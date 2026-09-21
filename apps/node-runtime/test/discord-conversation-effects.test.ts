import { describe, expect, it } from "vitest";

import type { DiscordPeerAgentBinding } from "../src/discord-conversation-composition.js";
import { discordDelegationSurfaceEffect } from "../src/discord-conversation-effects.js";

function peer(index: number): DiscordPeerAgentBinding {
  return {
    participantKeys: [`bot:${index + 1}`],
    participantId: `ptc_named_agent_${String(index).padStart(2, "0")}`,
    roleId: index % 2 === 0 ? "product-owner" : "developer",
    displayName: `Named agent ${index}`,
    agentBinding: {
      agentId: `agt_${index.toString(16).padStart(24, "0")}`,
      roleVersion: "1.0.0",
      roleContractHash: `sha256:${"a".repeat(64)}`,
      roleProfileHash: `sha256:${"b".repeat(64)}`,
    },
    tenantKeys: ["123"],
    conversationIds: ["cnv_conversation01"],
  };
}

describe("Discord conversation effects", () => {
  it("represents all routable delegation peers as exact bounded argument choices", () => {
    const effect = discordDelegationSurfaceEffect(
      Array.from({ length: 64 }, (_, index) => peer(index)),
    );

    expect(effect.argumentDescription?.length).toBeLessThanOrEqual(256);
    expect(effect.argumentChoices).toHaveLength(64);
    expect(effect.argumentChoices?.[0]).toEqual({
      value: "ptc_named_agent_00",
      label: "Named agent 0 (product-owner)",
    });
    expect(effect.argumentChoices?.[63]).toEqual({
      value: "ptc_named_agent_63",
      label: "Named agent 63 (developer)",
    });
  });
});
