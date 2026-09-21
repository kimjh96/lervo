import { expect, it } from "vitest";

import { managedConversationTurnInstructions } from "../src/managed-turn-contract.js";

it("classifies the requested deliverable instead of incidental implementation steps", () => {
  const instructions = JSON.parse(
    managedConversationTurnInstructions({
      request: {
        event: { actor: { kind: "human" } },
        mentioned: false,
        respondingAgent: {
          participantId: "ptc_owner",
          agentId: "agt_owner",
          roleId: "product-owner",
        },
        policy: { roleId: "product-owner" },
        surfaceEffects: [],
      } as never,
      message: "Implement the already approved design and run its ordinary checks.",
      plan: { role: { roleId: "product-owner" }, executionIdentity: {} } as never,
    }),
  ) as { instruction: string[] };

  const guidance = instructions.instruction.join(" ");
  expect(guidance).toContain("Classify the primary requested deliverable");
  expect(guidance).toContain("Ordinary implementation remains routine");
  expect(guidance).toContain("independent assessment is the requested deliverable");
});
