import { describe, expect, it } from "vitest";
import { validateSchema } from "@lervo/schemas";
import { sanitizeEventPayload } from "../src/redaction.js";

const hash = `sha256:${"a".repeat(64)}`;
const prepared = {
  observationId: "tobs_appliedrules01",
  executionMode: "unmanaged",
  providerSessionDigest: `sha256:${"b".repeat(64)}`,
  providerTurnDigest: null,
  sourceSnapshotId: `ksnap_${"c".repeat(24)}`,
  queryDigest: `sha256:${"d".repeat(64)}`,
  contextHash: `sha256:${"e".repeat(64)}`,
  recommendationCount: 0,
  loadedDocuments: [],
} as const;

function envelope(schemaVersion: number, payload: Record<string, unknown>) {
  return {
    eventId: "evt_appliedrules0001",
    projectId: "prj_applied_rules_1",
    runId: "run_applied_rules_1",
    sessionId: "ses_applied_rules_1",
    seq: 1,
    type: "terminal.context.prepared",
    occurredAt: "2026-11-27T09:00:00.000Z",
    actor: { kind: "system" },
    schemaVersion,
    policyVersion: hash,
    payload,
    previousHash: null,
    eventHash: hash,
  };
}

describe("owner rules Lervo prepared for a terminal turn (schema 15)", () => {
  const counted = {
    ...prepared,
    appliedInstructions: { status: "complete", preparedCount: 2, omittedCount: 0 },
  };

  it("is readable from schema 15, while a prepared context without it stays readable", () => {
    for (let schemaVersion = 1; schemaVersion <= 15; schemaVersion++) {
      expect(validateSchema("event", envelope(schemaVersion, counted)).valid).toBe(
        schemaVersion >= 15,
      );
      expect(validateSchema("event", envelope(schemaVersion, prepared)).valid).toBe(true);
    }
  });

  it("keeps the report's status and counts, with an unknown omission as null", () => {
    for (const appliedInstructions of [
      { status: "complete", preparedCount: 2, omittedCount: 0 },
      { status: "incomplete", preparedCount: 1, omittedCount: 3 },
      { status: "incomplete", preparedCount: 0, omittedCount: 0 },
      { status: "incomplete", preparedCount: 256, omittedCount: 4096 },
      { status: "unavailable", preparedCount: 0, omittedCount: null },
    ]) {
      const payload = { ...prepared, appliedInstructions };
      expect(sanitizeEventPayload("terminal.context.prepared", payload).payload).toEqual(payload);
    }
  });

  it("refuses rule text, extra keys, and counts the report cannot produce", () => {
    for (const appliedInstructions of [
      { status: "complete", preparedCount: 2, omittedCount: 0, rules: ["Always run tests"] },
      { status: "complete", preparedCount: 2, omittedCount: 0, delivery: "delivered" },
      { status: "applied", preparedCount: 2, omittedCount: 0 },
      { status: "2 owner rules applied", preparedCount: 2, omittedCount: 0 },
      { status: "complete", preparedCount: 2 },
      { status: "complete", preparedCount: 2, omittedCount: 1 },
      { status: "complete", preparedCount: 2, omittedCount: null },
      { status: "incomplete", preparedCount: 1, omittedCount: null },
      { status: "unavailable", preparedCount: 1, omittedCount: null },
      { status: "unavailable", preparedCount: 0, omittedCount: 0 },
      { status: "incomplete", preparedCount: 257, omittedCount: 0 },
      { status: "incomplete", preparedCount: 1, omittedCount: 4097 },
      { status: "incomplete", preparedCount: -1, omittedCount: 0 },
      "2 owner rules prepared",
    ])
      expect(
        () =>
          sanitizeEventPayload("terminal.context.prepared", { ...prepared, appliedInstructions }),
        JSON.stringify(appliedInstructions),
      ).toThrow();
  });
});
