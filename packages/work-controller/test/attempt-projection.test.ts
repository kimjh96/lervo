import { describe, expect, it } from "vitest";

import { projectManagedAttempts } from "../src/index.js";
import { assignment, causalityPayload, event, workstreamId } from "./fixtures.js";

describe("managed attempt projection", () => {
  it("replays root and retry attempts while retaining accounting boundaries", () => {
    const node = assignment("1");
    const rootRun = "run_111111111111111111111111";
    const retryRun = "run_222222222222222222222222";
    const workId = "wrk_111111111111111111111111";
    const descriptor = `sha256:${"a".repeat(64)}`;
    const events = [
      event(
        1,
        "work.causality.recorded",
        rootRun,
        causalityPayload({ assignmentId: node.assignmentId }),
      ),
      event(2, "adapter.started", rootRun, {}, "codex"),
      event(3, "run.failed", rootRun, {}),
      event(
        4,
        "resource.usage.recorded",
        rootRun,
        {
          workId,
          resourceObservationId: "ruo_111111111111111111111111",
          sourceCoordinateDigest: `sha256:${"b".repeat(64)}`,
          scope: "primary_provider",
          source: "provider_reported",
          accountingMode: "turn_cumulative",
          accountingDescriptorHash: descriptor,
          status: "observed",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 2,
            outputTokens: 4,
            reasoningOutputTokens: 1,
            totalTokens: 14,
            contextWindow: 200000,
          },
          reasonCode: null,
        },
        "codex",
      ),
      event(
        5,
        "work.causality.recorded",
        retryRun,
        causalityPayload({
          assignmentId: node.assignmentId,
          workId,
          relationship: "retry",
          parentRunId: rootRun,
          retryOfRunId: rootRun,
          attemptOrdinal: 2,
        }),
      ),
      event(6, "adapter.started", retryRun, {}, "codex"),
      event(7, "run.completed", retryRun, { verificationStatus: "passed" }),
      event(
        8,
        "resource.usage.recorded",
        retryRun,
        {
          workId,
          resourceObservationId: "ruo_222222222222222222222222",
          sourceCoordinateDigest: `sha256:${"c".repeat(64)}`,
          scope: "primary_provider",
          source: "provider_reported",
          accountingMode: "turn_cumulative",
          accountingDescriptorHash: descriptor,
          status: "observed",
          usage: {
            inputTokens: 6,
            cachedInputTokens: 1,
            outputTokens: 2,
            reasoningOutputTokens: 0,
            totalTokens: 8,
            contextWindow: 200000,
          },
          reasonCode: null,
        },
        "codex",
      ),
    ];

    const projection = projectManagedAttempts({ events, workstreamId });
    expect(projection.attempts.map((attempt) => attempt.terminalStatus)).toEqual([
      "failed",
      "completed",
    ]);
    expect(projection.resources).toMatchObject([
      { provider: "codex", completeness: "complete", totalTokens: 22, runCount: 2 },
    ]);
  });

  it("rejects a provider resource observation attributed to a different run provider", () => {
    const node = assignment("1");
    const runId = "run_111111111111111111111111";
    const workId = "wrk_111111111111111111111111";
    expect(() =>
      projectManagedAttempts({
        workstreamId,
        events: [
          event(
            1,
            "work.causality.recorded",
            runId,
            causalityPayload({ assignmentId: node.assignmentId }),
          ),
          event(2, "adapter.started", runId, {}, "claude"),
          event(
            3,
            "resource.usage.recorded",
            runId,
            {
              workId,
              resourceObservationId: "ruo_111111111111111111111111",
              sourceCoordinateDigest: `sha256:${"b".repeat(64)}`,
              scope: "primary_provider",
              source: "provider_reported",
              accountingMode: "turn_cumulative",
              accountingDescriptorHash: `sha256:${"a".repeat(64)}`,
              status: "unavailable",
              usage: null,
              reasonCode: "resource_observation_missing",
            },
            "codex",
          ),
        ],
      }),
    ).toThrow("differs from its run provider");
  });
});
