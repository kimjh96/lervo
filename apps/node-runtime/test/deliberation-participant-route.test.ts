import { describe, expect, it } from "vitest";

import {
  deliberationExecutionRouteHash,
  workforceProviderPolicyHash,
} from "@lervo/agent-organization";
import { DEFAULT_MODEL_SELECTION, type ModelSelection } from "@lervo/execution-contract";

import type { NodeDiscordConversationConfig } from "../src/config-types.js";
import { deliberationParticipantRoute } from "../src/deliberation-participant-route.js";

const endpoint = {
  agentParticipantId: "ptc_agent01",
  integrationId: "itg_discord01",
  routing: {
    readOnlyRoleId: "researcher",
    response: { provider: "codex", model: "gpt-response", reasoningEffort: "high" },
  },
  command: { provider: "codex" },
} as unknown as NodeDiscordConversationConfig;
const route = { policyId: "dpol_1", policyRoleId: "reviewer" };
const any = workforceProviderPolicyHash("any");
const selection =
  (roles: ModelSelection["roles"]): (() => ModelSelection) =>
  () => ({ ...DEFAULT_MODEL_SELECTION, revision: 1, roles });
const hash = (provider: "codex" | "claude", model: string | null, effort: string | null) =>
  deliberationExecutionRouteHash({
    participantId: "ptc_agent01",
    integrationId: "itg_discord01",
    provider,
    model,
    reasoningEffort: effort as never,
  });
const claudeOnly = selection({
  reasoning: [{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: null }],
});

describe("deliberation participant routes (ADR-0612 M2c)", () => {
  it("keeps the configured route and its full hash while the role is unset", () => {
    expect(
      deliberationParticipantRoute({
        route,
        endpoint,
        existing: undefined,
        providerPolicyHash: any,
        readSelection: selection({}),
      }),
    ).toEqual({
      provider: "codex",
      model: "gpt-response",
      reasoningEffort: "high",
      executionRouteHash: hash("codex", "gpt-response", "high"),
    });
  });

  it("binds only the provider of a seat the selection routes", () => {
    const accepted = deliberationParticipantRoute({
      route,
      endpoint,
      existing: undefined,
      providerPolicyHash: any,
      readSelection: claudeOnly,
    });
    expect(accepted).toEqual({
      provider: "claude",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
      executionRouteHash: hash("claude", null, null),
    });
    // A later model change resumes the same seat with the new model and the same hash.
    expect(
      deliberationParticipantRoute({
        route,
        endpoint,
        existing: { executionRouteHash: accepted.executionRouteHash, executionProvider: "claude" },
        providerPolicyHash: any,
        readSelection: selection({
          reasoning: [{ provider: "codex", model: "gpt-x", reasoningEffort: "max" }],
        }),
      }),
    ).toEqual({
      provider: "claude",
      model: null,
      reasoningEffort: null,
      executionRouteHash: accepted.executionRouteHash,
    });
  });

  it("resumes a seat accepted before this release on its configured route", () => {
    const legacy = hash("codex", "gpt-response", "high");
    expect(
      deliberationParticipantRoute({
        route,
        endpoint,
        existing: { executionRouteHash: legacy, executionProvider: "codex" },
        providerPolicyHash: any,
        readSelection: claudeOnly,
      }).executionRouteHash,
    ).toBe(legacy);
  });
});
