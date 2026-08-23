import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { auditProductLanguage } from "../audit-product-language.mjs";

describe("product language audit", () => {
  it("classifies documentation, runtime, generated knowledge, and test findings without exposing text", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-language-audit-"));
    try {
      await mkdir(resolve(root, "apps/cli/src"), { recursive: true });
      await mkdir(resolve(root, "packages/example/test"), { recursive: true });
      await mkdir(resolve(root, "docs/knowledge"), { recursive: true });
      await writeFile(resolve(root, "README.md"), "# \uC608\uC2DC\n");
      await writeFile(resolve(root, "apps/cli/src/main.ts"), "const message = '\uC2E4\uD589';\n");
      await writeFile(resolve(root, "packages/example/test/example.test.ts"), "const fixture = '\uAC80\uC99D';\n");
      await writeFile(resolve(root, "docs/knowledge/index.md"), "# \uC9C0\uC2DD\n");
      await writeFile(resolve(root, "apps/cli/src/english.ts"), "const message = 'run';\n");

      const report = await auditProductLanguage(root);

      assert.deepEqual(report.categories, {
        documentation: { fileCount: 1, lineCount: 1 },
        generated_knowledge: { fileCount: 1, lineCount: 1 },
        runtime_surface: { fileCount: 1, lineCount: 1 },
        test_fixture: { fileCount: 1, lineCount: 1 },
      });
      assert.deepEqual(report.findings.map(({ path, category, lineNumbers }) => ({ path, category, lineNumbers })), [
        { path: "README.md", category: "documentation", lineNumbers: [1] },
        { path: "apps/cli/src/main.ts", category: "runtime_surface", lineNumbers: [1] },
        { path: "docs/knowledge/index.md", category: "generated_knowledge", lineNumbers: [1] },
        { path: "packages/example/test/example.test.ts", category: "test_fixture", lineNumbers: [1] },
      ]);
      assert.equal(JSON.stringify(report).includes("\uC2E4\uD589"), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
