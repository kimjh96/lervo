import { describe, expect, it } from "vitest";

import { createEventReaderCapabilities, readEventReaderCapabilities } from "../src/index.js";

describe("event reader capabilities", () => {
  it("advertises reader versions without granting writer activation", () => {
    const capabilities = createEventReaderCapabilities();

    expect(capabilities).toEqual({
      schemaVersion: 1,
      capability: "event_reader",
      readableEventSchemaVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
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
});
