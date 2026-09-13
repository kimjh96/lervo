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
});
