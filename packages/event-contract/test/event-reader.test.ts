import { describe, expect, it } from "vitest";

import { readEventEnvelope } from "../src/index.js";

function event(schemaVersion: number) {
  const withoutHash = {
    eventId: "evt_reader_compatibility_01",
    projectId: "prj_reader_compatibility_01",
    runId: "run_reader_compatibility_01",
    sessionId: "ses_reader_compatibility_01",
    seq: 1,
    type: "run.requested",
    occurredAt: "2026-09-01T00:00:00.000Z",
    actor: { kind: "user" },
    schemaVersion,
    policyVersion: `sha256:${"a".repeat(64)}`,
    payload: {},
    previousHash: null,
  };
  return { ...withoutHash, eventHash: `sha256:${"b".repeat(64)}` };
}

describe("event reader compatibility", () => {
  it("reads v1, v2 and v3 without changing their bytes", () => {
    for (const schemaVersion of [1, 2, 3]) {
      const source = event(schemaVersion);
      expect(readEventEnvelope(source)).toEqual(source);
    }
  });

  it("distinguishes unsupported versions from invalid supported envelopes", () => {
    expect(() => readEventEnvelope(event(4))).toThrowError(
      expect.objectContaining({ code: "event_schema_unsupported" }),
    );
    expect(() => readEventEnvelope({ ...event(2), eventId: "invalid" })).toThrowError(
      expect.objectContaining({ code: "event_invalid" }),
    );
  });
});
