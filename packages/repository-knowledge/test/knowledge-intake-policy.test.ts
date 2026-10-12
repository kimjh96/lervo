import { describe, expect, it } from "vitest";

import {
  compileKnowledgeScannerExclusion,
  knowledgeScannerExcludes,
} from "../src/knowledge-intake-policy.js";
import { defaultRepositoryKnowledgePolicy } from "../src/policy.js";

describe("compiled scanner exclusion", () => {
  it("preserves existing wildcard, literal, directory-root, and transient-cache semantics", () => {
    const paths = [
      "",
      "src",
      "src/a.ts",
      "a/b/c.md",
      "node_modules",
      "node_modules/a.js",
      "a/node_modules",
      "a/node_modules/pkg/a.js",
      ".cache",
      "a/.cache/data.json",
      "literal[1]+(x).md",
      "한글/문서.md",
      "a/b",
      "a/b/",
      "a/b/c",
    ];
    const patterns = [
      [],
      ["**"],
      ["*.md"],
      ["src/**"],
      ["a/*"],
      ["**/b/**"],
      ["literal[1]+(x).md"],
      ["한글/**"],
      defaultRepositoryKnowledgePolicy.exclude,
    ];
    for (const exclude of patterns) {
      const policy = { exclude };
      const compiled = compileKnowledgeScannerExclusion(policy);
      for (const path of paths)
        expect(compiled(path), JSON.stringify({ exclude, path })).toBe(
          knowledgeScannerExcludes(path, policy),
        );
    }
    expect(compileKnowledgeScannerExclusion({ exclude: ["src/**"] })("src")).toBe(true);
    expect(compileKnowledgeScannerExclusion({ exclude: ["*.md"] })("a/b.md")).toBe(false);
  });

  it("captures only this observation's policy and recompiles changed policy on the next observation", () => {
    const policy = { exclude: ["old/**"] };
    const old = compileKnowledgeScannerExclusion(policy);
    policy.exclude[0] = "new/**";
    const current = compileKnowledgeScannerExclusion(policy);
    expect([old("old/file"), old("new/file")]).toEqual([true, false]);
    expect([current("old/file"), current("new/file")]).toEqual([false, true]);
  });
});
