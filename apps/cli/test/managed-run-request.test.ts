import { describe, expect, it } from "vitest";

import { resolveManagedRunExpectedPaths } from "../src/managed-run-request.js";

describe("managed run expected paths", () => {
  it("preserves the legacy single path and accepts an exact path set", () => {
    expect(resolveManagedRunExpectedPaths({ expectedPath: "./src/result.ts" })).toEqual([
      "src/result.ts",
    ]);
    expect(resolveManagedRunExpectedPaths({ expectedPaths: ["src/a.ts", "docs/a.md"] })).toEqual([
      "src/a.ts",
      "docs/a.md",
    ]);
  });

  it("rejects ambiguous, empty, duplicate, or escaping path input", () => {
    expect(() =>
      resolveManagedRunExpectedPaths({ expectedPath: "src/a.ts", expectedPaths: ["src/a.ts"] }),
    ).toThrow("not both");
    expect(() => resolveManagedRunExpectedPaths({ expectedPaths: [] })).toThrow("1 to 128");
    expect(() =>
      resolveManagedRunExpectedPaths({ expectedPaths: ["src/a.ts", "src/a.ts"] }),
    ).toThrow("unique");
    expect(() => resolveManagedRunExpectedPaths({ expectedPaths: ["../outside"] })).toThrow(
      "repository-relative",
    );
  });
});
