import { expect, it } from "vitest";
import { applyArtifactCorrectionEdits } from "../src/artifact-correction.js";
it("changes only exact authorized ranges and preserves other bytes", () => {
  const bytes = Buffer.from("owner bad owner");
  const result = applyArtifactCorrectionEdits(
    bytes,
    [{ startByte: 6, endByte: 9 }],
    [{ startByte: 6, endByte: 9, replacement: "good" }],
  );
  expect(Buffer.from(result).toString()).toBe("owner good owner");
  expect(bytes.toString()).toBe("owner bad owner");
});
it("rejects edits outside the range, overlaps and split UTF-8 characters", () => {
  const bytes = Buffer.from("한글 original");
  expect(() =>
    applyArtifactCorrectionEdits(
      bytes,
      [{ startByte: 0, endByte: 3 }],
      [{ startByte: 0, endByte: 6, replacement: "x" }],
    ),
  ).toThrow();
  expect(() =>
    applyArtifactCorrectionEdits(
      bytes,
      [{ startByte: 0, endByte: 6 }],
      [{ startByte: 1, endByte: 3, replacement: "x" }],
    ),
  ).toThrow();
  expect(() =>
    applyArtifactCorrectionEdits(
      bytes,
      [{ startByte: 0, endByte: 6 }],
      [
        { startByte: 0, endByte: 6, replacement: "x" },
        { startByte: 3, endByte: 6, replacement: "y" },
      ],
    ),
  ).toThrow();
});
it("rejects oversized and malformed replacement text", () => {
  for (const replacement of ["x".repeat(1048577), "\ud800"]) {
    expect(() =>
      applyArtifactCorrectionEdits(
        Buffer.from("a"),
        [{ startByte: 0, endByte: 1 }],
        [{ startByte: 0, endByte: 1, replacement }],
      ),
    ).toThrow();
  }
});
