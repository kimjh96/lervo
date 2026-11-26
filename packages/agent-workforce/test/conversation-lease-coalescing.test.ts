import { describe, expect, it } from "vitest";

import { coalesceLeaseEntries, minimalPathCover } from "../src/conversation-lease-coalescing.js";

describe("conversation lease coalescing", () => {
  it("keeps a set that fits and drops paths a directory already covers", () => {
    expect(minimalPathCover(["src/net/a.ts", "src/net", "docs/x.md", "src/net"])).toEqual([
      "docs/x.md",
      "src/net",
    ]);
    expect(
      coalesceLeaseEntries({
        entries: ["src/b.ts", "src/a.ts"],
        limit: 2,
        heldPaths: [],
        responsibilityPaths: ["."],
      }),
    ).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("takes the deepest candidate first, breaking ties by path order", () => {
    const entries = ["src/a/x/1.ts", "src/a/x/2.ts", "src/b/y/1.ts", "src/b/y/2.ts", "top.ts"];
    expect(
      coalesceLeaseEntries({ entries, limit: 4, heldPaths: [], responsibilityPaths: ["."] }),
    ).toEqual(["src/a/x", "src/b/y/1.ts", "src/b/y/2.ts", "top.ts"]);
    expect(
      coalesceLeaseEntries({ entries, limit: 2, heldPaths: [], responsibilityPaths: ["."] }),
    ).toEqual(["src", "top.ts"]);
  });

  it("skips candidates that overlap another holder or leave the responsibility", () => {
    const entries = ["src/a/1.ts", "src/a/2.ts", "src/b/1.ts", "src/b/2.ts"];
    expect(
      coalesceLeaseEntries({
        entries,
        limit: 3,
        heldPaths: ["src/a/held.ts"],
        responsibilityPaths: ["src"],
      }),
    ).toEqual(["src/a/1.ts", "src/a/2.ts", "src/b"]);
    expect(
      coalesceLeaseEntries({
        entries,
        limit: 1,
        heldPaths: [],
        responsibilityPaths: ["src/a", "src/b"],
      }),
    ).toBeNull();
    expect(
      coalesceLeaseEntries({
        entries,
        limit: 1,
        heldPaths: ["src/c.ts"],
        responsibilityPaths: ["src"],
      }),
    ).toBeNull();
  });
});
