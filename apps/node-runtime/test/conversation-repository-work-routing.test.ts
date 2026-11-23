import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL_SELECTION, type ModelSelection } from "@lervo/execution-contract";

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

describe("conversation repository work routing by model role (ADR-0612)", () => {
  const selection =
    (roles: ModelSelection["roles"]): (() => ModelSelection) =>
    () => ({ ...DEFAULT_MODEL_SELECTION, revision: 1, roles });
  const base = {
    sessionProvider: null,
    boundProvider: "any" as const,
    defaultProvider: "codex" as const,
    executionProfiles,
    startable: () => true,
  };

  it("lets a set role choose new work's provider among this Node's executors", () => {
    expect(
      selectConversationRepositoryWorkRoute({
        ...base,
        executionProfile: "reasoning",
        executors: { claude: {} },
        readSelection: selection({
          reasoning: [
            { provider: "codex", model: "gpt-x", reasoningEffort: "max" },
            { provider: "claude", model: "claude-opus-5-5", reasoningEffort: null },
          ],
        }),
      }),
    ).toEqual({
      provider: "claude",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
      executionProfile: "reasoning",
      allocationReason: "profile_preference",
    });
  });

  it("keeps a continued session's provider and takes the role's route for it", () => {
    expect(
      selectConversationRepositoryWorkRoute({
        ...base,
        sessionProvider: "codex",
        executionProfile: null,
        readSelection: selection({
          routine: [{ provider: "codex", model: "gpt-fast", reasoningEffort: "low" }],
        }),
      }),
    ).toMatchObject({ provider: "codex", model: "gpt-fast", reasoningEffort: "low" });
  });

  it("keeps the configured profile route while the role is unset", () => {
    expect(
      selectConversationRepositoryWorkRoute({
        ...base,
        executionProfile: "review",
        readSelection: selection({}),
      }),
    ).toMatchObject({ provider: "claude", model: "claude-review", reasoningEffort: "high" });
  });
});

it("fails new work visibly when the set role lists no provider the bound agent may use", () => {
  expect(() =>
    selectConversationRepositoryWorkRoute({
      sessionProvider: null,
      boundProvider: null,
      defaultProvider: "codex",
      executionProfile: null,
      executors: { codex: {} },
      readSelection: () => ({
        ...DEFAULT_MODEL_SELECTION,
        revision: 1,
        roles: { routine: [{ provider: "claude", model: null, reasoningEffort: null }] },
      }),
    }),
  ).toThrow(expect.objectContaining({ code: "provider_not_admitted" }));
});

it("passes over a listed provider whose CLI this host cannot start", () => {
  expect(
    selectConversationRepositoryWorkRoute({
      sessionProvider: null,
      boundProvider: "any",
      defaultProvider: "codex",
      executionProfile: null,
      executors: { codex: {}, claude: {} },
      startable: (provider) => provider === "claude",
      readSelection: () => ({
        ...DEFAULT_MODEL_SELECTION,
        revision: 1,
        roles: {
          routine: [
            { provider: "codex", model: "gpt-x", reasoningEffort: null },
            { provider: "claude", model: "claude-sonnet-5-5", reasoningEffort: null },
          ],
        },
      }),
    }),
  ).toMatchObject({ provider: "claude", model: "claude-sonnet-5-5" });
});
