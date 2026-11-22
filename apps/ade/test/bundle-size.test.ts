import { describe, expect, it } from "vitest";

// @ts-expect-error The bundle check is a plain build script without type declarations.
import { BUDGETS, bundleViolations } from "../scripts/check-bundle-size.mjs";

describe("the bundle-size check", () => {
  it("reports the start screen and lazy chunks over their budgets", () => {
    expect(
      bundleViolations({ initialGzipBytes: 1, largestLazyChunk: "a.js", largestLazyGzipBytes: 1 }),
    ).toEqual([]);
    expect(
      bundleViolations({
        initialGzipBytes: BUDGETS.initialGzipBytes + 1,
        largestLazyChunk: "assets/terminal.js",
        largestLazyGzipBytes: BUDGETS.lazyChunkGzipBytes + 1,
      }),
    ).toHaveLength(2);
  });
});
