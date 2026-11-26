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

  it("accepts a newer reader that reports more versions than this release reads", () => {
    // A writer of this release validates the reports of readers released after it, so a reader
    // that reads schema 17 and beyond must still pass while activation waits for it.
    const newer = {
      schemaVersion: 1,
      capability: "event_reader",
      readableEventSchemaVersions: Array.from({ length: 40 }, (_, index) => index + 1),
    };
    expect(readEventReaderCapabilities(newer)).toEqual(newer);
    expect(() =>
      readEventReaderCapabilities({
        ...newer,
        readableEventSchemaVersions: Array.from({ length: 65 }, (_, index) => index + 1),
      }),
    ).toThrowError(expect.objectContaining({ code: "event_reader_capabilities_invalid" }));
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
