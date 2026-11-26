import { describe, expect, it } from "vitest";
import { parseEventWriterCoordinateJson, validateSchema } from "../src/index.js";

function coordinate(version: number) {
  return {
    schemaVersion: Math.max(1, version - 1),
    projectId: "prj_coordinate",
    selectedEventSchemaVersion: version,
    activationEvidence:
      version === 1
        ? null
        : {
            activationId: `evact_${"a".repeat(24)}`,
            observedAt: "2026-10-12T00:00:00Z",
            configurationHash: `sha256:${"a".repeat(64)}`,
            readers: [
              {
                readerId: "reader_coordinate",
                readerKind: "local",
                peerIdentityHash: null,
                capabilities: {
                  schemaVersion: 1,
                  capability: "event_reader",
                  readableEventSchemaVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
                },
              },
            ],
          },
  };
}

function compare(value: unknown) {
  const text = JSON.stringify(value);
  const expected = validateSchema("eventWriterCoordinate", JSON.parse(text)).valid;
  expect(parseEventWriterCoordinateJson(text)).toEqual(expected ? value : null);
}

function mutations(value: unknown): unknown[] {
  const replacements: unknown[] = [null, true, false, 0, 1, 7, 1.5, "", "invalid", [], {}];
  if (value === null || typeof value !== "object") return replacements;
  const result = [...replacements];
  for (const key of Object.keys(value)) {
    const missing = structuredClone(value) as Record<string, unknown>;
    delete missing[key];
    result.push(missing);
    for (const replacement of mutations((value as Record<string, unknown>)[key])) {
      const changed = structuredClone(value) as Record<string, unknown>;
      changed[key] = replacement;
      result.push(changed);
    }
  }
  return result;
}

describe("owned coordinate JSON parsing", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])(
    "preserves version %i and malformed nested data verdicts",
    (version) => {
      const value = coordinate(version);
      expect(validateSchema("eventWriterCoordinate", value).valid).toBe(true);
      expect(parseEventWriterCoordinateJson(JSON.stringify(value))).toEqual(value);
      for (const mutation of mutations(value)) compare(mutation);
    },
  );

  it("retains JSON syntax failure and rejects unknown discriminators", () => {
    expect(() => parseEventWriterCoordinateJson("{")).toThrow(SyntaxError);
    for (const version of [-1, 0, 11, 255, 1.5, "6", null])
      compare({ ...coordinate(6), selectedEventSchemaVersion: version });
    compare({ ...coordinate(6), unexpected: true });
  });

  it("keeps full validator error output independent of parsing", () => {
    const invalid = { ...coordinate(6), activationEvidence: null };
    const before = validateSchema("eventWriterCoordinate", invalid);
    expect(before.valid).toBe(false);
    expect(parseEventWriterCoordinateJson(JSON.stringify(invalid))).toBeNull();
    expect(validateSchema("eventWriterCoordinate", invalid)).toEqual(before);
  });
});
