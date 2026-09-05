import { expect, it } from "vitest";

import { sameFileAcrossStatSurfaces } from "../src/safe-file-reader.js";

const pathObservation = { dev: 12, ino: 34, size: 56, mtimeMs: 78 };

it("accepts Windows path and handle observations with non-comparable identities", () => {
  expect(
    sameFileAcrossStatSurfaces(pathObservation, { ...pathObservation, dev: 0, ino: 0 }, "win32"),
  ).toBe(true);
});

it("still requires stable metadata across Windows stat surfaces", () => {
  expect(
    sameFileAcrossStatSurfaces(
      pathObservation,
      { ...pathObservation, dev: 0, ino: 0, size: pathObservation.size + 1 },
      "win32",
    ),
  ).toBe(false);
  expect(
    sameFileAcrossStatSurfaces(
      pathObservation,
      { ...pathObservation, dev: 0, ino: 0, mtimeMs: pathObservation.mtimeMs + 1 },
      "win32",
    ),
  ).toBe(false);
});

it("requires identity and metadata across comparable stat surfaces", () => {
  expect(sameFileAcrossStatSurfaces(pathObservation, pathObservation, "linux")).toBe(true);
  expect(
    sameFileAcrossStatSurfaces(pathObservation, { ...pathObservation, ino: 35 }, "linux"),
  ).toBe(false);
});
