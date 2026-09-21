import { describe, expect, it } from "vitest";

import { selectConversationRepositoryWorkRoute } from "../src/conversation-repository-work-routing.js";

const executionProfiles = {
  routine: {
    preferredProvider: "claude" as const,
    providers: {
      codex: { model: "gpt-standard", reasoningEffort: "medium" as const },
      claude: { model: "claude-standard", reasoningEffort: "medium" as const },
    },
  },
  reasoning: {
    preferredProvider: "codex" as const,
    providers: {
      codex: { model: "gpt-deep", reasoningEffort: "high" as const },
      claude: { model: "claude-deep", reasoningEffort: "high" as const },
    },
  },
  review: {
    preferredProvider: "claude" as const,
    providers: {
      codex: { model: "gpt-review", reasoningEffort: "high" as const },
      claude: { model: "claude-review", reasoningEffort: "high" as const },
    },
  },
};

describe("conversation repository work routing", () => {
  it("uses semantic quality profiles to distribute new work", () => {
    expect(
      selectConversationRepositoryWorkRoute({
        sessionProvider: null,
        boundProvider: "any",
        defaultProvider: "codex",
        executionProfile: "routine",
        executionProfiles,
      }),
    ).toEqual({
      provider: "claude",
      model: "claude-standard",
      reasoningEffort: "medium",
      executionProfile: "routine",
      allocationReason: "profile_preference",
    });
    expect(
      selectConversationRepositoryWorkRoute({
        sessionProvider: null,
        boundProvider: "any",
        defaultProvider: "claude",
        executionProfile: "reasoning",
        executionProfiles,
      }),
    ).toMatchObject({ provider: "codex", model: "gpt-deep", reasoningEffort: "high" });
  });

  it("selects the quality profile across provider sessions", () => {
    expect(
      selectConversationRepositoryWorkRoute({
        sessionProvider: "claude",
        boundProvider: "any",
        defaultProvider: "codex",
        executionProfile: "reasoning",
        executionProfiles,
      }),
    ).toEqual({
      provider: "codex",
      model: "gpt-deep",
      reasoningEffort: "high",
      executionProfile: "reasoning",
      allocationReason: "profile_preference",
    });
    expect(
      selectConversationRepositoryWorkRoute({
        sessionProvider: "codex",
        boundProvider: "any",
        defaultProvider: "codex",
        executionProfile: "review",
        executionProfiles,
      }),
    ).toMatchObject({ provider: "claude", model: "claude-review" });
  });

  it("retains the exact provider of a replayed event", () => {
    expect(
      selectConversationRepositoryWorkRoute({
        replayProvider: "codex",
        sessionProvider: "claude",
        boundProvider: "any",
        defaultProvider: "codex",
        executionProfile: "review",
        executionProfiles,
      }),
    ).toMatchObject({ provider: "codex", allocationReason: "session_continuity" });
  });

  it("fails closed instead of silently lowering a bound agent's profile", () => {
    expect(() =>
      selectConversationRepositoryWorkRoute({
        sessionProvider: null,
        boundProvider: "claude",
        defaultProvider: "codex",
        executionProfile: "reasoning",
        executionProfiles: {
          ...executionProfiles,
          reasoning: {
            preferredProvider: "codex",
            providers: { codex: executionProfiles.reasoning.providers.codex },
          },
        },
      }),
    ).toThrow("has no route for the retained claude provider");
  });
});
