import { describe, expect, it } from "vitest";

import { validateSchema } from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "evt_compatibility_01",
    projectId: "prj_compatibility_01",
    runId: "run_compatibility_01",
    sessionId: "ses_compatibility_01",
    seq: 1,
    type: "run.requested",
    occurredAt: "2026-09-01T00:00:00.000Z",
    actor: { kind: "user" },
    schemaVersion: 1,
    policyVersion: hash,
    payload: {},
    previousHash: null,
    eventHash: hash,
    ...overrides,
  };
}

describe("reader-first event envelope compatibility", () => {
  it("accepts v1 and v2 envelopes while rejecting an unsupported version", () => {
    expect(validateSchema("event", envelope()).valid).toBe(true);
    expect(validateSchema("event", envelope({ schemaVersion: 2 })).valid).toBe(true);
    expect(validateSchema("event", envelope({ schemaVersion: 3 })).valid).toBe(false);
  });

  it("keeps foundation event types unavailable to v1 envelopes", () => {
    const causality = {
      workId: `wrk_${"b".repeat(24)}`,
      executionContractVersion: 1,
      relationship: "root",
      parentRunId: null,
      retryOfRunId: null,
      attemptOrdinal: 1,
      workstreamId: null,
      assignmentId: null,
      agentId: null,
    };
    expect(
      validateSchema(
        "event",
        envelope({ schemaVersion: 2, type: "work.causality.recorded", payload: causality }),
      ).valid,
    ).toBe(true);
    expect(
      validateSchema(
        "event",
        envelope({ schemaVersion: 1, type: "work.causality.recorded", payload: causality }),
      ).valid,
    ).toBe(false);
  });

  it("validates the new payload status and execution-mode discriminators", () => {
    const usage = {
      workId: `wrk_${"b".repeat(24)}`,
      resourceObservationId: `ruo_${"c".repeat(24)}`,
      sourceCoordinateDigest: hash,
      scope: "primary_provider",
      source: "provider_reported",
      accountingMode: "turn_cumulative",
      accountingDescriptorHash: hash,
      status: "unavailable",
      usage: null,
      reasonCode: "provider_counter_missing",
    };
    expect(validateSchema("resourceUsageRecordedEventPayload", usage).valid).toBe(true);
    expect(
      validateSchema("resourceUsageRecordedEventPayload", { ...usage, reasonCode: null }).valid,
    ).toBe(false);

    const stages = {
      executionMode: "managed",
      workId: `wrk_${"b".repeat(24)}`,
      terminalObservationId: null,
      observationSetId: `stgobs_${"d".repeat(24)}`,
      stageCatalogVersion: 1,
      environmentProfileDigest: hash,
      repositoryProfile: "small",
      stages: [
        {
          stageId: "total",
          parentStageId: null,
          durationMs: 12.5,
          budgetMs: null,
          outcome: "completed",
          coldState: "unknown",
        },
      ],
    };
    expect(validateSchema("executionStagesObservedEventPayload", stages).valid).toBe(true);
    expect(
      validateSchema("executionStagesObservedEventPayload", {
        ...stages,
        terminalObservationId: "tobs_terminal_01",
      }).valid,
    ).toBe(false);
  });
});
