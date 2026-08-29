import { createHash } from "node:crypto";

import { createAdapterTurnResult } from "../../packages/adapter-contract/dist/index.js";
import { describe, expect, it } from "vitest";

import { runProviderShadowV2Turn } from "../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-turn.mjs";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

class ProviderFixtureAdapter {
  constructor(provider, content, eventMode = "completed") {
    this.provider = provider;
    this.content = content;
    this.eventMode = eventMode;
    this.descriptor = {
      adapterId: `lervo/${provider}`,
      provider,
    };
  }

  async start(request) {
    this.session = {
      adapterId: this.descriptor.adapterId,
      projectId: request.projectId,
      runId: request.runId,
      sessionId: request.sessionId,
      roleId: request.roleId,
      writingPolicyId: null,
      provider: this.provider,
      providerSessionId: `${this.provider}-provider-session`,
      executionMode: "read_only",
    };
    return this.session;
  }

  async injectContext(session, envelope) {
    return {
      receiptId: `ctx_${this.provider}_receipt`,
      controlledInput: true,
      providerSessionId: session.providerSessionId,
      targetTurnId: envelope.targetTurnId,
      documents: envelope.documents.map((document) => ({
        documentId: document.documentId,
        contentHash: document.contentHash,
        documentRole: document.documentRole,
        referenceEligible: document.referenceEligible,
        status: "injected",
      })),
    };
  }

  async attachManagedWriteBridge() {}

  async startTurn(session, request, accepted) {
    this.turn = {
      adapterId: this.descriptor.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      targetTurnId: request.targetTurnId,
      providerTurnId: `${this.provider}-provider-turn`,
      acceptedAt: "2026-08-29T00:00:00.000Z",
    };
    accepted(structuredClone(this.turn));
    return this.turn;
  }

  async *events() {
    if (this.eventMode !== "missing_usage")
      yield {
        type: "provider.usage.updated",
        payload: {
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 10,
          reasoningOutputTokens: 0,
          totalTokens: 110,
          contextWindow: 200000,
        },
      };
    if (this.eventMode === "tool")
      yield {
        type: "provider.tool.called",
        payload: { providerItemId: "tool-one", status: "completed" },
      };
    if (this.eventMode === "failed") {
      yield {
        type: "provider.turn.failed",
        payload: { providerTurnId: this.turn.providerTurnId },
      };
      return;
    }
    yield {
      type: "provider.turn.completed",
      payload: { providerTurnId: this.turn.providerTurnId, status: "completed" },
    };
  }

  async getTurnResult(session, turn) {
    return createAdapterTurnResult({
      session,
      turn,
      content: this.content,
      producedAt: "2026-08-29T00:00:01.000Z",
    });
  }

  async stop() {}
}

function fixture(provider, content, options = {}) {
  const text = "bounded candidate body";
  const candidate = {
    documentId: "doc_candidate_one",
    contentHash: digest(text),
    byteCount: Buffer.byteLength(text),
    classes: ["recommendation"],
  };
  const boundaries = [];
  const adapterOptions = [];
  return {
    adapterOptions,
    boundaries,
    input: {
      createAdapter: (requestedProvider, _root, _model, requestedOptions) => {
        expect(requestedProvider).toBe(provider);
        adapterOptions.push(requestedOptions);
        return new ProviderFixtureAdapter(provider, content(candidate), options.eventMode);
      },
      provider,
      repositoryRoot: "/fixture",
      projectId: "prj_fixture1",
      model: provider === "codex" ? "gpt-5.6-sol" : "opus",
      runSpec: {
        sampleId: `psv2_${provider}_fixture_r1`,
        shadowRunId: `run_psv2_${provider}_fixture_r1`,
        sessionId: `ses_psv2_${provider}_fixture_r1`,
        targetTurnId: `psturn_psv2_${provider}_fixture_r1`,
        query: "select evidence",
        candidates: [candidate],
      },
      materialByDocumentId: new Map([[candidate.documentId, { path: "docs/fixture.md", text }]]),
      timeoutMs: 1000,
      maximumResultBytes: options.maximumResultBytes ?? 4096,
      maximumSelectedSources: 8,
      stopConditions: [
        "provider_shadow_adapter_failed",
        "provider_shadow_result_invalid",
        "provider_shadow_terminal_invalid",
        "provider_shadow_tool_activity",
        "provider_shadow_result_oversize",
        "provider_shadow_selection_invalid",
        "provider_shadow_usage_unavailable",
      ],
      lastDurableAttemptDigest: `sha256:${"a".repeat(64)}`,
      onBoundary: async (stage, coordinates) => {
        boundaries.push({ stage, coordinates });
        return { digest: digest(JSON.stringify({ stage, coordinates })) };
      },
    },
  };
}

describe("paired provider-shadow v2 turn boundary", () => {
  for (const provider of ["codex", "claude"]) {
    it(`uses the same canonical success boundary for ${provider}`, async () => {
      const { input, boundaries } = fixture(
        provider,
        (candidate) => `<!-- lervo-e4:${candidate.documentId}:${candidate.contentHash} -->`,
      );
      const result = await runProviderShadowV2Turn(input);
      expect(result).toMatchObject({
        status: "observed",
        providerInvocationCount: 1,
        selected: [
          {
            documentId: input.runSpec.candidates[0].documentId,
            contentHash: input.runSpec.candidates[0].contentHash,
          },
        ],
      });
      expect(boundaries.map((item) => item.stage)).toEqual([
        "session_started",
        "context_injected",
        "turn_accepted",
        "turn_completed",
      ]);
    });
  }

  it.each([
    [
      "codex",
      (candidate) => `<!-- lervo-e4:${candidate.documentId}:${candidate.contentHash} -->`,
      false,
    ],
    [
      "claude",
      (candidate) =>
        JSON.stringify({
          evidenceTokens: [`lervo-e4:${candidate.documentId}:${candidate.contentHash}`],
        }),
      true,
    ],
  ])(
    "normalizes the provider-native exact token carrier for %s",
    async (provider, content, structured) => {
      const { input, adapterOptions } = fixture(provider, content);
      input.selectionOutput = "provider_native_exact_e4_token_set";
      input.selectionProtocolId = "linked-evidence-provider-shadow-minimal-sufficient-v9";
      input.selectionCarrier = structured ? "json_schema_e4_token_array" : "standalone_e4_comments";

      const result = await runProviderShadowV2Turn(input);

      expect(result).toMatchObject({ status: "observed", providerInvocationCount: 1 });
      expect(adapterOptions).toHaveLength(1);
      expect(adapterOptions[0].structuredOutputSchema !== undefined).toBe(structured);
    },
  );

  it.each(["codex", "claude"])(
    "requests the common JSON Schema token carrier for future %s structured contracts",
    async (provider) => {
      const { input, adapterOptions } = fixture(provider, (candidate) =>
        JSON.stringify({
          evidenceTokens: [`lervo-e4:${candidate.documentId}:${candidate.contentHash}`],
        }),
      );
      input.selectionOutput = "structured_exact_e4_token_array";
      input.selectionCarrier = "json_schema_e4_token_array";

      const result = await runProviderShadowV2Turn(input);

      expect(result).toMatchObject({ status: "observed", providerInvocationCount: 1 });
      expect(adapterOptions).toHaveLength(1);
      expect(adapterOptions[0].structuredOutputSchema).toMatchObject({
        type: "object",
        properties: { evidenceTokens: { type: "array" } },
        required: ["evidenceTokens"],
        additionalProperties: false,
      });
    },
  );

  it("returns bounded unavailable state instead of throwing after acceptance", async () => {
    const { input, boundaries } = fixture("codex", () => "unbounded prose");
    const result = await runProviderShadowV2Turn(input);
    expect(result).toMatchObject({
      status: "unavailable",
      failureCode: "provider_shadow_selection_invalid",
      selectionViolationCodes: ["provider_shadow_prose_present"],
      availabilityStage: "turn_completed",
      providerInvocationCount: 1,
    });
    expect(result).not.toHaveProperty("content");
    expect(boundaries.at(-1).stage).toBe("turn_completed");
  });

  it.each([
    ["provider_shadow_tool_activity", { eventMode: "tool" }],
    ["provider_shadow_terminal_invalid", { eventMode: "failed" }],
    ["provider_shadow_usage_unavailable", { eventMode: "missing_usage" }],
    ["provider_shadow_result_oversize", { maximumResultBytes: 1 }],
  ])("records the bounded %s diagnostic without raw output", async (failureCode, options) => {
    const { input } = fixture(
      "claude",
      (candidate) => `<!-- lervo-e4:${candidate.documentId}:${candidate.contentHash} -->`,
      options,
    );
    const result = await runProviderShadowV2Turn(input);
    expect(result).toMatchObject({ status: "unavailable", failureCode });
    expect(result.selectionViolationCodes).toEqual([]);
    expect(result).not.toHaveProperty("content");
  });
});
