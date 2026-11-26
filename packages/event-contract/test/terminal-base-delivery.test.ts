import { describe, expect, it } from "vitest";
import { validateSchema } from "@lervo/schemas";
import { sanitizeEventPayload } from "../src/redaction.js";

const hash = `sha256:${"a".repeat(64)}`;
const delivered = {
  reason: "declined_busy",
  cacheAgeMilliseconds: 41_000,
  deliveredAt: "2026-11-26T14:00:00.000Z",
} as const;

function envelope(schemaVersion: number, payload: Record<string, unknown>) {
  return {
    eventId: "evt_basedelivery0001",
    projectId: "prj_base_delivery_1",
    runId: `run_basedelivery_${"a".repeat(32)}`,
    sessionId: `ses_basedelivery_${"a".repeat(32)}`,
    seq: 1,
    type: "terminal.context.base_delivered",
    occurredAt: "2026-11-26T14:00:01.000Z",
    actor: { kind: "system" },
    schemaVersion,
    policyVersion: hash,
    payload,
    previousHash: null,
    eventHash: hash,
  };
}

describe("a prompt answered from the cached base (schema 14, ADR-0645)", () => {
  it("is an event type only from schema 14", () => {
    for (let schemaVersion = 1; schemaVersion <= 14; schemaVersion++)
      expect(validateSchema("event", envelope(schemaVersion, delivered)).valid).toBe(
        schemaVersion === 14,
      );
  });

  it("keeps the reason, the base's age, and the time, and drops anything else", () => {
    for (const reason of ["no_server", "unreachable", "declined_busy"]) {
      const payload = { ...delivered, reason };
      expect(sanitizeEventPayload("terminal.context.base_delivered", payload).payload).toEqual(
        payload,
      );
    }
    for (const payload of [
      { ...delivered, reason: "declined_runtime_mismatch" },
      { ...delivered, cacheAgeMilliseconds: 1_800_001 },
      { ...delivered, cacheAgeMilliseconds: -1 },
      { reason: "unreachable", deliveredAt: delivered.deliveredAt },
    ])
      expect(() => sanitizeEventPayload("terminal.context.base_delivered", payload)).toThrow();
    const extra = sanitizeEventPayload("terminal.context.base_delivered", {
      ...delivered,
      prompt: "fix the form",
      cwd: "/home/owner/repository",
    });
    expect(extra.payload).toEqual(delivered);
    expect(extra.redactions.map((redaction) => redaction.path).sort()).toEqual([
      "$.cwd",
      "$.prompt",
    ]);
  });
});
