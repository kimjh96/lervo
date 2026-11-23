import { describe, expect, it } from "vitest";

import { staticCheckUnaffected } from "../changed-verification/static-verification-plan.mjs";

describe("static verification plan", () => {
  it("skips lint and typecheck only for Markdown and Lervo state changes", () => {
    expect(staticCheckUnaffected([])).toBe(true);
    expect(
      staticCheckUnaffected([
        "docs/decisions/foundation/0562-one-relation-web.md",
        "README.md",
        ".lervo/knowledge/document-normalizations/x.yaml",
      ]),
    ).toBe(true);
  });

  it("runs the full check for code, configuration, lockfiles, and verification suites", () => {
    for (const path of [
      "apps/cli/src/bin.ts",
      "scripts/quality/check-docs.mjs",
      "eslint.config.js",
      "tsconfig.json",
      "package.json",
      "pnpm-lock.yaml",
      "packages/schemas/src/event.json",
      ".lervo/verifications/repository.default.v9.yaml",
      ".lervo/generated/terminal-hooks/runtime-v2.mjs",
      "docs/notes.txt",
    ])
      expect(staticCheckUnaffected(["docs/guide.md", path])).toBe(false);
  });
});
