import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@lervo/schemas";

import { projectWorkExecutionReport } from "../src/work-execution-report.js";

const projectId = "prj_fixture001";
const workId = "wrk_111111111111111111111111";
const hash = `sha256:${"a".repeat(64)}`;

function event(
  seq: number,
  type: EventEnvelope["type"],
  payload: Record<string, unknown>,
  actor: EventEnvelope["actor"] = { kind: "system" },
): EventEnvelope {
  return {
    eventId: `evt_fixture${String(seq).padStart(3, "0")}`,
    projectId,
    runId: "run_fixture001",
    sessionId: "ses_fixture001",
    seq,
    type,
    occurredAt: `2026-09-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    actor,
    schemaVersion:
      type === "work.causality.recorded" ||
      type === "resource.usage.recorded" ||
      type === "execution.stages.observed"
        ? 2
        : 1,
    policyVersion: hash,
    payload,
    previousHash: seq === 1 ? null : hash,
    eventHash: hash,
  } as EventEnvelope;
}

describe("work execution report", () => {
  it("deduplicates observations while keeping provider totals and missing stages explicit", () => {
    const events = [
      event(1, "work.causality.recorded", {
        workId,
        executionContractVersion: 1,
        relationship: "root",
        parentRunId: null,
        retryOfRunId: null,
        attemptOrdinal: 1,
        workstreamId: null,
        assignmentId: null,
        agentId: null,
      }),
      event(2, "run.requested", {}),
      event(3, "adapter.started", {}, { kind: "provider", provider: "codex" }),
      event(
        4,
        "resource.usage.recorded",
        {
          workId,
          resourceObservationId: "ruo_111111111111111111111111",
          sourceCoordinateDigest: hash,
          scope: "primary_provider",
          source: "provider_reported",
          accountingMode: "turn_cumulative",
          accountingDescriptorHash: hash,
          modelIdentity: {
            provider: "codex",
            requestedModel: null,
            answerModel: "codex-fixture",
            observedModelIds: ["codex-fixture"],
            answerModelEvidence: "thread_start",
            unavailableReason: null,
          },
          status: "observed",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 2,
            outputTokens: 4,
            reasoningOutputTokens: 1,
            totalTokens: 14,
            contextWindow: 128_000,
          },
          reasonCode: null,
        },
        { kind: "provider", provider: "codex" },
      ),
      event(5, "run.completed", {}),
    ];
    events.splice(
      4,
      0,
      event(5, "resource.usage.recorded", structuredClone(events[3]!.payload), {
        kind: "provider",
        provider: "codex",
      }),
    );
    events[5] = event(6, "run.completed", {});

    const report = projectWorkExecutionReport({ projectId, workId, events });

    expect(report.resources).toMatchObject({
      completeness: "complete",
      missingReasons: [],
      groups: [
        {
          provider: "codex",
          totalUsage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
        },
      ],
    });
    expect(report).toMatchObject({
      completeness: "partial",
      stages: {
        completeness: "unavailable",
        missingReasons: ["stage_observation_missing"],
      },
      cost: { status: "not_in_foundation_scope" },
    });
  });

  it("does not fabricate zero when a managed run lacks a resource observation", () => {
    const events = [
      event(1, "work.causality.recorded", {
        workId,
        executionContractVersion: 1,
        relationship: "root",
        parentRunId: null,
        retryOfRunId: null,
        attemptOrdinal: 1,
        workstreamId: null,
        assignmentId: null,
        agentId: null,
      }),
      event(2, "run.requested", {}),
      event(3, "adapter.started", {}, { kind: "provider", provider: "claude" }),
      event(4, "run.failed", {}),
    ];

    expect(projectWorkExecutionReport({ projectId, workId, events }).resources).toEqual({
      completeness: "unavailable",
      missingReasons: ["resource_observation_missing"],
      groups: [],
    });
  });

  it("projects one bounded stage set and rejects a second set for the same run", () => {
    const causality = event(1, "work.causality.recorded", {
      workId,
      executionContractVersion: 1,
      relationship: "root",
      parentRunId: null,
      retryOfRunId: null,
      attemptOrdinal: 1,
      workstreamId: null,
      assignmentId: null,
      agentId: null,
    });
    const stagePayload = {
      executionMode: "managed",
      workId,
      terminalObservationId: null,
      terminalHook: null,
      observationSetId: "stgobs_111111111111111111111111",
      stageCatalogVersion: 1,
      environmentProfileDigest: hash,
      repositoryProfile: "small",
      stages: [
        {
          stageId: "total",
          parentStageId: null,
          durationMs: 12,
          budgetMs: null,
          outcome: "completed",
          coldState: "warm",
        },
      ],
    };
    const events = [
      causality,
      event(2, "run.requested", {}),
      event(3, "execution.stages.observed", stagePayload),
      event(4, "run.completed", {}),
    ];

    expect(projectWorkExecutionReport({ projectId, workId, events }).stages).toEqual({
      completeness: "complete",
      missingReasons: [],
      observationSetCount: 1,
      observations: [
        {
          runId: "run_fixture001",
          observationSetId: stagePayload.observationSetId,
          environmentProfileDigest: hash,
          repositoryProfile: "small",
          stages: stagePayload.stages,
        },
      ],
    });

    const contradictory = [
      ...events.slice(0, 3),
      event(4, "execution.stages.observed", {
        ...stagePayload,
        observationSetId: "stgobs_222222222222222222222222",
      }),
      event(5, "run.completed", {}),
    ];
    expect(
      projectWorkExecutionReport({ projectId, workId, events: contradictory }).stages,
    ).toMatchObject({
      completeness: "invalid",
      missingReasons: ["stage_observation_invalid"],
    });
  });
});
