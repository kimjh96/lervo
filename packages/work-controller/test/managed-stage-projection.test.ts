import { describe, expect, it } from "vitest";

import { projectManagedAttempts } from "../src/index.js";
import { assignment, causalityPayload, event, workstreamId } from "./fixtures.js";

describe("managed stage projection", () => {
  it("keeps exact run observations and marks a missing retry set partial", () => {
    const node = assignment("1");
    const rootRun = "run_111111111111111111111111";
    const retryRun = "run_222222222222222222222222";
    const workId = "wrk_111111111111111111111111";
    const stageEvent = event(3, "execution.stages.observed", rootRun, {
      executionMode: "managed",
      workId,
      terminalObservationId: null,
      terminalHook: null,
      observationSetId: "stgobs_111111111111111111111111",
      stageCatalogVersion: 2,
      environmentProfileDigest: `sha256:${"a".repeat(64)}`,
      repositoryProfile: "small",
      stages: [
        {
          stageId: "total",
          parentStageId: null,
          durationMs: 90,
          budgetMs: null,
          outcome: "completed",
          coldState: "warm",
        },
        {
          stageId: "provider_turn",
          parentStageId: "total",
          durationMs: 60,
          budgetMs: null,
          outcome: "completed",
          coldState: "warm",
        },
      ],
    });
    stageEvent.schemaVersion = 2;
    const projection = projectManagedAttempts({
      workstreamId,
      events: [
        event(
          1,
          "work.causality.recorded",
          rootRun,
          causalityPayload({ assignmentId: node.assignmentId }),
        ),
        event(2, "adapter.started", rootRun, {}, "codex"),
        stageEvent,
        event(
          4,
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
        event(5, "adapter.started", retryRun, {}, "codex"),
      ],
    });

    expect(projection.stages).toEqual([
      expect.objectContaining({
        provider: "codex",
        scope: "primary_provider",
        stageId: "provider_turn",
        completeness: "partial",
        runCount: 1,
        reasonCodes: ["stage_observation_missing"],
        observations: [
          expect.objectContaining({ runId: rootRun, durationMs: 60, outcome: "completed" }),
        ],
      }),
      expect.objectContaining({
        stageId: "total",
        completeness: "partial",
        observations: [expect.objectContaining({ durationMs: 90 })],
      }),
    ]);
  });
});
