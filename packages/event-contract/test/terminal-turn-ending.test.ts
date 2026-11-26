import { describe, expect, it } from "vitest";
import { validateSchema } from "@lervo/schemas";
import { sanitizeEventPayload } from "../src/redaction.js";

const hash = `sha256:${"a".repeat(64)}`;
const observed = {
  observationId: "tobs_turnending0001",
  contextEventId: "evt_turnending0001",
  referenceEventIds: [],
  referenceCount: 0,
  referenceTelemetry: "observed",
  lifecycleStatus: "current",
  completionResult: "allowed",
  providerSessionDigest: hash,
  providerTurnDigest: null,
} as const;

function screen(payload: Record<string, unknown>) {
  return sanitizeEventPayload("terminal.turn.observed", payload);
}

function envelope(schemaVersion: number, payload: Record<string, unknown>) {
  return {
    eventId: "evt_turnending0002",
    projectId: "prj_turn_ending_01",
    runId: "run_turn_ending_01",
    sessionId: "ses_turn_ending_01",
    seq: 1,
    type: "terminal.turn.observed",
    occurredAt: "2026-11-25T09:00:00.000Z",
    actor: { kind: "provider", provider: "claude" },
    schemaVersion,
    policyVersion: hash,
    payload,
    previousHash: null,
    eventHash: hash,
  };
}

describe("a turn that ended without a Stop hook (schema 12)", () => {
  it("records how it ended and that the Stop gate never checked it", () => {
    for (const ending of ["next_prompt", "session_end", "session_start", "provider_interrupt"]) {
      const settled = { ...observed, completionResult: "not_checked", ending };
      expect(screen(settled).payload).toEqual(settled);
    }
    // Absent or explicit, a Stop-hook ending keeps the gate's verdict.
    expect(screen(observed).payload).toEqual(observed);
    const stopped = { ...observed, completionResult: "blocked", ending: "stop_hook" };
    expect(screen(stopped).payload).toEqual(stopped);
  });

  it("never reports a verdict the gate did not give, or an unchecked Stop-hook turn", () => {
    for (const payload of [
      { ...observed, ending: "next_prompt" },
      { ...observed, completionResult: "blocked", ending: "session_end" },
      { ...observed, completionResult: "not_checked" },
      { ...observed, completionResult: "not_checked", ending: "stop_hook" },
      { ...observed, completionResult: "not_checked", ending: "timeout" },
    ])
      expect(() => screen(payload)).toThrow();
  });

  it("is readable from schema 12, while the Stop-hook shape stays readable everywhere", () => {
    const settled = { ...observed, completionResult: "not_checked", ending: "next_prompt" };
    const explicit = { ...observed, ending: "stop_hook" };
    for (const schemaVersion of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      expect(validateSchema("event", envelope(schemaVersion, settled)).valid).toBe(
        schemaVersion >= 12,
      );
      expect(validateSchema("event", envelope(schemaVersion, explicit)).valid).toBe(
        schemaVersion >= 12,
      );
      expect(validateSchema("event", envelope(schemaVersion, observed)).valid).toBe(true);
    }
  });
});
