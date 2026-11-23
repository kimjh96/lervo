import { describe, expect, it } from "vitest";

import {
  deliberationExecutionRouteHash,
  selectionRoutedDeliberationRouteHash,
} from "@lervo/agent-organization";
import { DEFAULT_MODEL_SELECTION, type ModelSelection } from "@lervo/execution-contract";

import type { NodeDiscordConversationConfig } from "../src/config-types.js";
import { deliberationParticipantRoute } from "../src/deliberation-participant-route.js";

const endpoint = {
  agentParticipantId: "ptc_agent01",
  integrationId: "itg_discord01",
  routing: {
    readOnlyRoleId: "researcher",
    response: { provider: "claude", model: "claude-response", reasoningEffort: "high" },
  },
  command: { provider: "claude" },
} as unknown as NodeDiscordConversationConfig;
const coordinates = { participantId: "ptc_agent01", integrationId: "itg_discord01" };
const selection =
  (roles: ModelSelection["roles"]): (() => ModelSelection) =>
  () => ({ ...DEFAULT_MODEL_SELECTION, revision: 1, roles });
const claudeRoute = selection({
  reasoning: [{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: null }],
});

describe("deliberation participant routes (ADR-0612 M2c)", () => {
  it("keeps the configured route and its full hash while the role does not list the seat's provider", () => {
    for (const readSelection of [selection({}), claudeRoute]) {
      const codexSeat = {
        policyId: "dpol_1",
        policyRoleId: "verifier",
        provider: "codex" as const,
      };
      expect(
        deliberationParticipantRoute({
          route: codexSeat,
          endpoint,
          existing: undefined,
          readSelection,
        }),
      ).toEqual({
        provider: "codex",
        model: "claude-response",
        reasoningEffort: "high",
        executionRouteHash: deliberationExecutionRouteHash({
          ...coordinates,
          provider: "codex",
          model: "claude-response",
          reasoningEffort: "high",
        }),
      });
    }
  });

  it("keeps the seat's provider and takes the role's model, binding only the provider", () => {
    const route = { policyId: "dpol_1", policyRoleId: "reviewer" };
    const accepted = deliberationParticipantRoute({
      route,
      endpoint,
      existing: undefined,
      readSelection: claudeRoute,
    });
    const marker = selectionRoutedDeliberationRouteHash({ ...coordinates, provider: "claude" });
    expect(accepted).toEqual({
      provider: "claude",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
      executionRouteHash: marker,
    });
    // A later model change resumes the same seat on the new model with the same hash.
    expect(
      deliberationParticipantRoute({
        route,
        endpoint,
        existing: { executionRouteHash: marker },
        readSelection: selection({
          reasoning: [{ provider: "claude", model: "claude-sonnet-5-5", reasoningEffort: "max" }],
        }),
      }),
    ).toEqual({
      provider: "claude",
      model: "claude-sonnet-5-5",
      reasoningEffort: "max",
      executionRouteHash: marker,
    });
  });

  it("resumes a configured seat unchanged, even one with no model or effort", () => {
    const bare = {
      ...endpoint,
      routing: { readOnlyRoleId: "researcher", response: { provider: "claude" } },
    } as unknown as NodeDiscordConversationConfig;
    const route = { policyId: "dpol_1", policyRoleId: "reviewer" };
    const configured = deliberationExecutionRouteHash({
      ...coordinates,
      provider: "claude",
      model: null,
      reasoningEffort: null,
    });
    expect(configured).not.toBe(
      selectionRoutedDeliberationRouteHash({ ...coordinates, provider: "claude" }),
    );
    expect(
      deliberationParticipantRoute({
        route,
        endpoint: bare,
        existing: { executionRouteHash: configured },
        readSelection: claudeRoute,
      }),
    ).toEqual({
      provider: "claude",
      model: null,
      reasoningEffort: null,
      executionRouteHash: configured,
    });
  });
});
