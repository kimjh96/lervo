import { describe, expect, it } from "vitest";

import { managedSearchQuery } from "../src/managed-search-context.js";

describe("managed search query projection", () => {
  it("bounds a long task without changing the managed run request", () => {
    const projected = managedSearchQuery(`기능 ${"단어 ".repeat(80)}`, "src/result.ts");

    expect(projected.length).toBeLessThanOrEqual(500);
    expect(projected.split(" ")).toHaveLength(32);
  });

  it("uses the expected path only when the task has no searchable term", () => {
    expect(managedSearchQuery("✨ ---", "src/result.ts")).toBe("src result ts");
  });
});
