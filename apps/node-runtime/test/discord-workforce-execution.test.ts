import { describe, expect, it } from "vitest";

import type { NodeDiscordConversationConfig } from "../src/config-types.js";
import { discordWorkforceExecution } from "../src/discord-workforce-execution.js";

describe("Discord workforce execution ownership", () => {
  it.each([
    { actions: [], path: "/node/config.json", expected: "configured_agent" },
    {
      actions: ["incoming_webhook.create"],
      path: "/node/config.json",
      expected: "configured_agent",
    },
    {
      actions: ["workforce.agent.hire"],
      path: "/node/config.json",
      expected: "conversation_delegate",
    },
    {
      actions: ["workforce.agent.hire", "incoming_webhook.create"],
      path: undefined,
      expected: "conversation_delegate",
    },
    {
      actions: ["workforce.agent.hire", "incoming_webhook.create"],
      path: "/node/config.json",
      expected: "separate_deployment",
    },
  ])("selects $expected for $actions with config path $path", ({ actions, path, expected }) => {
    const config = { administration: { allowedActions: actions } } as NodeDiscordConversationConfig;
    expect(discordWorkforceExecution(config, path)).toBe(expected);
  });
});
