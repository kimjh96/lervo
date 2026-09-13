import { describe, expect, it } from "vitest";
import { repositoryPathWithinScope, repositoryPathScopesOverlap } from "../src/index.js";

describe("repository path authority", () => {
  it.each([".", "*"])("recognizes root %s without widening a narrow scope", (root) => {
    expect(repositoryPathWithinScope("docs/product/vision.md", root)).toBe(true);
    expect(repositoryPathWithinScope("docs/product/vision.md", "docs")).toBe(true);
    expect(repositoryPathWithinScope("docs-private/vision.md", "docs")).toBe(false);
    expect(repositoryPathWithinScope(root, "docs")).toBe(false);
    expect(repositoryPathScopesOverlap(root, "docs/product/vision.md")).toBe(true);
    expect(repositoryPathScopesOverlap("docs/product/vision.md", root)).toBe(true);
    expect(repositoryPathScopesOverlap("docs", "src")).toBe(false);
  });

  it.each([
    "",
    "..",
    "../secret",
    "docs/../secret",
    "/tmp/secret",
    "C:/secret",
    "docs\\secret",
    "docs/./file",
    "docs//file",
    "docs/",
    "secret\0",
  ])("does not grant an invalid or escaped path %j through a root scope", (path) => {
    for (const root of [".", "*"]) {
      expect(repositoryPathWithinScope(path, root)).toBe(false);
      expect(repositoryPathWithinScope(root, path)).toBe(false);
      expect(repositoryPathScopesOverlap(path, root)).toBe(false);
    }
  });
});
