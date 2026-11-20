import { parse } from "yaml";
import { expect, it, vi } from "vitest";

import { legacyNormalizationRecord } from "../src/normalization-record-version.js";

vi.mock("yaml", async (original) => {
  const actual = await original<typeof import("yaml")>();
  return { ...actual, parse: vi.fn(actual.parse) };
});

it("decodes a normalization record only once its content is new (ADR-0601)", () => {
  const current = "schemaVersion: 2\nsourcePath: docs/guide.md\n";
  expect(legacyNormalizationRecord(current)).toBeNull();
  const decoded = vi.mocked(parse).mock.calls.length;
  // The same bytes are not decoded again; changed bytes are.
  expect(legacyNormalizationRecord(current)).toBeNull();
  expect(vi.mocked(parse).mock.calls.length).toBe(decoded);
  expect(legacyNormalizationRecord(`${current}note: edited\n`)).toBeNull();
  expect(vi.mocked(parse).mock.calls.length).toBe(decoded + 1);
  // A legacy record is decoded every time, because its upgrade needs the value.
  const legacy = "schemaVersion: 1\nsourcePath: docs/old.md\n";
  expect(legacyNormalizationRecord(legacy)).toEqual({
    schemaVersion: 1,
    sourcePath: "docs/old.md",
  });
  expect(legacyNormalizationRecord(legacy)).toMatchObject({ schemaVersion: 1 });
  expect(vi.mocked(parse).mock.calls.length).toBe(decoded + 3);
});

it("still refuses an empty record as the planner always did", () => {
  expect(() => legacyNormalizationRecord("")).toThrow();
});
