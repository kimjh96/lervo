import { describe, expect, it } from "vitest";

import {
  createEventReaderCapabilities,
  readEventEnvelope,
  readEventReaderCapabilities,
} from "../src/index.js";

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
  it("advertises reader versions without granting writer activation", () => {
    const capabilities = createEventReaderCapabilities();

    expect(capabilities).toEqual({
      schemaVersion: 1,
      capability: "event_reader",
      readableEventSchemaVersions: [1, 2],
    });
    expect(capabilities).not.toHaveProperty("writableEventSchemaVersion");
    expect(readEventReaderCapabilities(capabilities)).toEqual(capabilities);
  });

  it("rejects unsupported or contradictory reader capability reports", () => {
    expect(() =>
      readEventReaderCapabilities({
        schemaVersion: 2,
        capability: "event_reader",
        readableEventSchemaVersions: [1, 2],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "event_reader_capabilities_schema_unsupported" }),
    );
    expect(() =>
      readEventReaderCapabilities({
        schemaVersion: 1,
        capability: "event_reader",
        readableEventSchemaVersions: [2, 1],
      }),
    ).toThrowError(expect.objectContaining({ code: "event_reader_capabilities_invalid" }));
  });

  it("reads v1 and v2 without changing their bytes", () => {
    for (const schemaVersion of [1, 2]) {
      const source = event(schemaVersion);
      expect(readEventEnvelope(source)).toEqual(source);
    }
  });

  it("distinguishes unsupported versions from invalid supported envelopes", () => {
    expect(() => readEventEnvelope(event(3))).toThrowError(
      expect.objectContaining({ code: "event_schema_unsupported" }),
    );
    expect(() => readEventEnvelope({ ...event(2), eventId: "invalid" })).toThrowError(
      expect.objectContaining({ code: "event_invalid" }),
    );
  });
});
