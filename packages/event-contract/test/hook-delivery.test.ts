import { describe, expect, it } from "vitest";
import { validateSchema } from "@lervo/schemas";
import { sanitizeEventPayload } from "../src/redaction.js";

const hash = `sha256:${"a".repeat(64)}`;
const observed = {
  executionMode: "unmanaged_terminal",
  workId: null,
  terminalObservationId: "tobs_hookdelivery01",
  terminalHook: "UserPromptSubmit",
  observationSetId: `stgobs_${"b".repeat(24)}`,
  stageCatalogVersion: 2,
  environmentProfileDigest: hash,
  repositoryProfile: "custom",
  stages: [
    {
      stageId: "total",
      parentStageId: null,
      durationMs: 120,
      budgetMs: null,
      outcome: "completed",
      coldState: "warm",
    },
  ],
} as const;

function envelope(schemaVersion: number, payload: Record<string, unknown>) {
  return {
    eventId: "evt_hookdelivery0001",
    projectId: "prj_hook_delivery_1",
    runId: "run_hook_delivery_1",
    sessionId: "ses_hook_delivery_1",
    seq: 1,
    type: "execution.stages.observed",
    occurredAt: "2026-11-26T09:00:00.000Z",
    actor: { kind: "system" },
    schemaVersion,
    policyVersion: hash,
    payload,
    previousHash: null,
    eventHash: hash,
  };
}

describe("how a terminal hook's answer was delivered (schema 13)", () => {
  const served = { ...observed, delivery: { channel: "context_server", answerMilliseconds: 84 } };
  const fallback = { ...observed, delivery: { channel: "in_process", fallback: "declined_busy" } };

  // Stage observations exist from schema 2.
  it("is readable only from schema 13, while observations without it stay readable", () => {
    for (const schemaVersion of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      expect(validateSchema("event", envelope(schemaVersion, served)).valid).toBe(
        schemaVersion === 13,
      );
      expect(validateSchema("event", envelope(schemaVersion, fallback)).valid).toBe(
        schemaVersion === 13,
      );
      expect(validateSchema("event", envelope(schemaVersion, observed)).valid).toBe(true);
    }
  });

  it("names an answer time for a served hook and a closed reason for one that ran in process", () => {
    for (const delivery of [
      { channel: "context_server", answerMilliseconds: 84, fallback: "no_server" },
      { channel: "in_process" },
      { channel: "in_process", fallback: "declined_busy", answerMilliseconds: 10 },
      { channel: "in_process", fallback: "something_else" },
      { channel: "context_server", answerMilliseconds: -1 },
      { channel: "context_server", answerMilliseconds: 600001 },
      { channel: "context_server", answerMilliseconds: "84" },
      { channel: "context_server", answerMilliseconds: 84, socket: "context.s" },
      { channel: "in_process", fallback: "no_server", path: "/home/owner" },
      { answerMilliseconds: 84 },
      null,
      { channel: "elsewhere", answerMilliseconds: 1 },
    ])
      expect(() =>
        sanitizeEventPayload("execution.stages.observed", { ...observed, delivery }),
      ).toThrow();
  });

  it("accepts a served hook whose answer came after its record, without a time", () => {
    const late = { ...observed, delivery: { channel: "context_server" } };
    expect(sanitizeEventPayload("execution.stages.observed", late).payload).toEqual(late);
    const unreported = { ...observed, delivery: { channel: "in_process", fallback: "unreported" } };
    expect(sanitizeEventPayload("execution.stages.observed", unreported).payload).toEqual(
      unreported,
    );
  });

  it("passes the redaction allowlist", () => {
    expect(sanitizeEventPayload("execution.stages.observed", served).payload).toEqual(served);
    expect(sanitizeEventPayload("execution.stages.observed", fallback).payload).toEqual(fallback);
    expect(sanitizeEventPayload("execution.stages.observed", observed).payload).toEqual(observed);
  });
});
