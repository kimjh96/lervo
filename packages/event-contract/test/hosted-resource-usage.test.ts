import { describe, expect, it } from "vitest";
import { validateSchema } from "@lervo/schemas";
import { sanitizeEventPayload } from "../src/redaction.js";

const digest = `sha256:${"a".repeat(64)}`;

// ADR-0632: one result's usage for one model in a hosted Claude session, from the canary's turn:
// 2 uncached + 15,028 cache-read + 10,482 cache-creation input tokens.
const hosted = {
  workId: null,
  hostedSession: { providerSessionDigest: digest, provider: "claude" },
  resourceObservationId: `ruo_${"b".repeat(24)}`,
  sourceCoordinateDigest: `sha256:${"c".repeat(64)}`,
  scope: "primary_provider",
  source: "provider_reported",
  accountingMode: "operation_delta",
  accountingDescriptorHash: `sha256:${"d".repeat(64)}`,
  modelIdentity: {
    provider: "claude",
    requestedModel: null,
    answerModel: "claude-opus-5-5[1m]",
    observedModelIds: ["claude-opus-5-5[1m]"],
    answerModelEvidence: "response_object",
    unavailableReason: null,
  },
  status: "observed",
  usage: {
    inputTokens: 25512,
    cachedInputTokens: 15028,
    outputTokens: 88,
    reasoningOutputTokens: 83,
    totalTokens: 25600,
    contextWindow: 1_000_000,
  },
  reasonCode: null,
  cacheCreationInputTokens: 10482,
  costUsd: 0.00229088,
  costBasis: "list",
} as const;

const managed = {
  workId: `wrk_${"e".repeat(24)}`,
  resourceObservationId: `ruo_${"f".repeat(24)}`,
  sourceCoordinateDigest: `sha256:${"c".repeat(64)}`,
  scope: "primary_provider",
  source: "provider_reported",
  accountingMode: "turn_cumulative",
  accountingDescriptorHash: `sha256:${"d".repeat(64)}`,
  modelIdentity: {
    provider: "claude",
    requestedModel: null,
    answerModel: "claude-opus-5-5",
    observedModelIds: ["claude-opus-5-5"],
    answerModelEvidence: "response_object",
    unavailableReason: null,
  },
  status: "observed",
  usage: {
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 10,
    reasoningOutputTokens: 0,
    totalTokens: 110,
    contextWindow: null,
  },
  reasonCode: null,
} as const;

function screen(payload: Record<string, unknown>) {
  return sanitizeEventPayload("resource.usage.recorded", payload);
}

function envelope(schemaVersion: number, payload: Record<string, unknown>) {
  return {
    eventId: "evt_hosted_usage_01",
    projectId: "prj_hosted_usage_01",
    runId: "run_hosted_usage_01",
    sessionId: "ses_hosted_usage_01",
    seq: 1,
    type: "resource.usage.recorded",
    occurredAt: "2026-11-25T09:00:00.000Z",
    actor: { kind: "system" },
    schemaVersion,
    policyVersion: digest,
    payload,
    previousHash: null,
    eventHash: digest,
  };
}

describe("hosted session usage in resource.usage.recorded (schema 11)", () => {
  it("keeps the counts, the cost, and the session digest, and drops any text", () => {
    const result = screen({ ...hosted, prompt: "Fix the login form", result: "Done." });
    expect(result.payload).toEqual(hosted);
    expect(result.redactions.map(({ path }) => path).sort()).toEqual(["$.prompt", "$.result"]);
    // An unreported cost is null with its basis, never a zero.
    const unreported = { ...hosted, costUsd: null, costBasis: "unreported" };
    expect(screen(unreported).payload).toEqual(unreported);
    // A name that fails the hosted pattern uses the identity's unavailable branch.
    const unnamed = {
      ...hosted,
      modelIdentity: {
        provider: "claude",
        requestedModel: null,
        answerModel: null,
        observedModelIds: [],
        answerModelEvidence: "unavailable",
        unavailableReason: "model_name_invalid",
      },
    };
    expect(screen(unnamed).payload).toEqual(unnamed);
    // Unreported reasoning is a 0 the status marks as partial.
    const partial = { ...hosted, status: "partial", reasonCode: "reasoning_unreported" };
    expect(
      screen({ ...partial, usage: { ...hosted.usage, reasoningOutputTokens: 0 } }).payload,
    ).toMatchObject({ status: "partial", reasonCode: "reasoning_unreported" });
  });

  it("refuses incoherent counts and costs", () => {
    for (const patch of [
      // Both cache counts are parts of the complete input.
      { usage: { ...hosted.usage, inputTokens: 25000, totalTokens: 25088 } },
      { cacheCreationInputTokens: -1 },
      { costBasis: "list", costUsd: null },
      { costBasis: "unreported", costUsd: 0.01 },
      { costBasis: "estimated" },
    ])
      expect(() => screen({ ...hosted, ...patch })).toThrow();
    const { costUsd: _cost, ...withoutCost } = hosted;
    expect(() => screen(withoutCost)).toThrow();
  });

  it("separates hosted and managed attribution", () => {
    const refused: Record<string, unknown>[] = [
      // A hosted record names its session and no work, agent, or turn.
      { ...hosted, workId: managed.workId },
      { ...hosted, hostedSession: undefined },
      {
        ...hosted,
        agentId: null,
        conversationDigest: null,
        channel: "terminal",
        turnEventId: "evt_turn_0001",
        stage: "provider_turn",
      },
      // Only a provider-reported measurement exists for a hosted turn.
      { ...hosted, source: "estimated" },
      // A managed record keeps its work and never names a hosted session or a bracketed tier.
      { ...managed, hostedSession: hosted.hostedSession },
      {
        ...managed,
        modelIdentity: { ...managed.modelIdentity, answerModel: "claude-opus-5-5[1m]" },
      },
    ];
    for (const payload of refused) {
      const defined = Object.fromEntries(
        Object.entries(payload).filter(([, value]) => value !== undefined),
      );
      expect(() => screen(defined)).toThrow();
    }
    expect(screen(managed).payload).toEqual(managed);
    // Managed readers parse versions 2 and 3 only, so a managed record reports no cost yet.
    const costed = { ...managed, cacheCreationInputTokens: 30, costUsd: 0.5, costBasis: "list" };
    expect(() => screen(costed)).toThrow();
    // A hosted result without usage records nothing, not an unavailable record with a cost.
    expect(() =>
      screen({ ...hosted, status: "unavailable", usage: null, reasonCode: "usage_unreported" }),
    ).toThrow();
  });

  it("is readable from schema 11, while the managed shape stays readable everywhere", () => {
    // The envelope refuses the schema-11 fields below 11 even where the payload screen would not.
    const costed = { ...managed, cacheCreationInputTokens: 30, costUsd: 0.5, costBasis: "list" };
    for (const schemaVersion of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
      expect(validateSchema("event", envelope(schemaVersion, hosted)).valid).toBe(
        schemaVersion >= 11,
      );
      expect(validateSchema("event", envelope(schemaVersion, costed)).valid).toBe(
        schemaVersion >= 11,
      );
      expect(validateSchema("event", envelope(schemaVersion, managed)).valid).toBe(true);
    }
  });
});
