import { describe, expect, it } from "vitest";
import { projectManagedAttempts, projectWorkstreamResources } from "../src/index.js";
import { causalityPayload, event, workstreamId } from "./fixtures.js";

describe("workstream resource scope", () => {
  it("includes an assignment-free owner run without inventing a worker attempt", () => {
    const runId = "run_111111111111111111111111";
    const causal = { ...causalityPayload({ assignmentId: "unused" }), assignmentId: null };
    const events = [
      event(1, "work.causality.recorded", runId, causal),
      event(2, "adapter.started", runId, {}, "codex"),
      event(
        3,
        "resource.usage.recorded",
        runId,
        {
          workId: causal.workId,
          resourceObservationId: "ruo_111111111111111111111111",
          sourceCoordinateDigest: `sha256:${"b".repeat(64)}`,
          scope: "primary_provider",
          source: "provider_reported",
          accountingMode: "turn_cumulative",
          accountingDescriptorHash: `sha256:${"a".repeat(64)}`,
          modelIdentity: {
            provider: "codex",
            requestedModel: null,
            answerModel: "fixture",
            observedModelIds: ["fixture"],
            answerModelEvidence: "thread_start",
            unavailableReason: null,
          },
          status: "observed",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 4,
            reasoningOutputTokens: 0,
            totalTokens: 14,
            contextWindow: 200000,
          },
          reasonCode: null,
        },
        "codex",
      ),
    ];
    expect(projectManagedAttempts({ events, workstreamId }).attempts).toEqual([]);
    expect(projectWorkstreamResources({ events, workstreamId })).toMatchObject({
      runIds: [runId],
      groups: [{ provider: "codex", completeness: "complete", totalTokens: 14, runCount: 1 }],
    });
    expect(projectWorkstreamResources({ events: events.slice(0, 2), workstreamId })).toEqual({
      runIds: [runId],
      groups: [],
    });
    expect(projectWorkstreamResources({ events, workstreamId: `wks_${"b".repeat(24)}` })).toEqual({
      runIds: [],
      groups: [],
    });
  });

  it("keeps unobserved owner descendants inside the goal's resource scope", () => {
    const runId = "run_111111111111111111111111";
    const childId = "run_222222222222222222222222";
    const causal = { ...causalityPayload({ assignmentId: "unused" }), assignmentId: null };
    const events = [
      event(1, "work.causality.recorded", runId, causal),
      event(2, "work.causality.recorded", childId, {
        ...causal,
        relationship: "subagent",
        parentRunId: runId,
      }),
    ];
    expect(projectWorkstreamResources({ events, workstreamId })).toEqual({
      runIds: [runId, childId],
      groups: [],
    });
  });

  it("retains an unavailable pre-start receipt without inventing provider use or a token count", () => {
    const ownerRunId = "run_222222222222222222222222";
    const owner = { ...causalityPayload({ assignmentId: "unused" }), assignmentId: null };
    const unavailable = event(
      2,
      "resource.usage.recorded",
      ownerRunId,
      {
        workId: owner.workId,
        resourceObservationId: "ruo_222222222222222222222222",
        sourceCoordinateDigest: `sha256:${"b".repeat(64)}`,
        scope: "primary_provider",
        source: "provider_reported",
        accountingMode: "turn_cumulative",
        accountingDescriptorHash: `sha256:${"a".repeat(64)}`,
        modelIdentity: {
          provider: "codex",
          requestedModel: null,
          answerModel: null,
          observedModelIds: [],
          answerModelEvidence: "unavailable",
          unavailableReason: "provider_model_unavailable",
        },
        status: "unavailable",
        usage: null,
        reasonCode: "resource_observation_missing",
      },
      "codex",
    );
    const failed = event(3, "run.failed", ownerRunId, {
      failureCode: "provider_start_failed",
      retryable: false,
    });
    const events = [event(1, "work.causality.recorded", ownerRunId, owner), unavailable, failed];
    expect(projectWorkstreamResources({ events, workstreamId }).groups).toMatchObject([
      { provider: "codex", completeness: "unavailable", totalTokens: null, runCount: 1 },
    ]);
    expect(() => projectWorkstreamResources({ events: events.slice(0, 2), workstreamId })).toThrow(
      "differs from its run provider",
    );
    expect(() =>
      projectWorkstreamResources({
        events: [
          events[0]!,
          unavailable,
          { ...failed, payload: { ...failed.payload, failureCode: "provider_turn_failed" } },
        ],
        workstreamId,
      }),
    ).toThrow("differs from its run provider");
  });
});
