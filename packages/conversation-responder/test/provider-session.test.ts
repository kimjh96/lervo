import { describe, expect, it } from "vitest";

import { MemoryConversationProviderSessionRegistry } from "../src/index.js";

describe("conversation provider session registry", () => {
  it("lets one role claim a provider session and rejects reuse by another role", async () => {
    const registry = new MemoryConversationProviderSessionRegistry();
    const coordinates = {
      projectId: "prj_conversation_bridge",
      provider: "codex",
      providerSessionId: "provider-session-1",
      runId: "run_reviewer",
      sessionId: "ses_reviewer",
      roleId: "reviewer",
    };

    await expect(registry.claim(coordinates)).resolves.toBe(true);
    await expect(registry.claim({
      ...coordinates,
      runId: "run_planner",
      sessionId: "ses_planner",
      roleId: "planner",
    })).resolves.toBe(false);
  });
});
