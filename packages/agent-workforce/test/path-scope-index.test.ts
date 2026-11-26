import { repositoryPathScopesOverlap, repositoryPathWithinScope } from "@lervo/work-controller";
import { describe, expect, it } from "vitest";

import { PathScopeIndex, pathAncestors } from "../src/path-scope-index.js";

const samples = [
  ".",
  "*",
  "src",
  "src/",
  "src/a.ts",
  "src/net",
  "src/net/retry.ts",
  "src/network",
  "docs",
  "docs/x.md",
  "a/b/c/d.ts",
  "a/b",
  "a//b",
  "a/./b",
  "../x",
];

describe("path scope index", () => {
  it("lists the ancestors below the root, deepest first", () => {
    expect(pathAncestors("a/b/c/d.ts")).toEqual(["a/b/c", "a/b", "a"]);
    expect(pathAncestors("top.ts")).toEqual([]);
  });

  it("answers exactly as the pairwise scope policy for every sample pair", () => {
    for (const scope of samples) {
      const index = new PathScopeIndex<string>();
      index.add(scope, scope);
      for (const path of samples) {
        expect([scope, path, index.covers(path)]).toEqual([
          scope,
          path,
          repositoryPathWithinScope(path, scope),
        ]);
        expect([scope, path, index.overlaps(path)]).toEqual([
          scope,
          path,
          repositoryPathScopesOverlap(path, scope),
        ]);
        expect([scope, path, index.overlapping(path).length !== 0]).toEqual([
          scope,
          path,
          repositoryPathScopesOverlap(path, scope),
        ]);
      }
    }
  });
});
