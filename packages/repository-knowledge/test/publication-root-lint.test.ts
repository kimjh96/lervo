import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lintPublicationRootResidents } from "../src/publication-root-lint.js";
import { isWithinPublicationRoot } from "../src/repository-publication-files.js";
import type { KnowledgeLintIssue } from "../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("generated publication root residents", () => {
  it("matches the publication root and its descendants only", () => {
    expect(isWithinPublicationRoot("docs/knowledge", "docs/knowledge/")).toBe(true);
    expect(isWithinPublicationRoot("docs/knowledge/repository/a.md", "./docs/knowledge")).toBe(
      true,
    );
    expect(isWithinPublicationRoot("docs/knowledge-base/a.md", "docs/knowledge")).toBe(false);
    expect(isWithinPublicationRoot("docs/decisions/knowledge/a.md", "docs/knowledge")).toBe(false);
  });

  it("warns about each file no recorded generation produced", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-publication-root-lint-"));
    roots.push(root);
    await mkdir(resolve(root, "docs/knowledge/repository"), { recursive: true });
    await writeFile(resolve(root, "docs/knowledge/index.md"), "# Index\n");
    await writeFile(resolve(root, "docs/knowledge/repository/knowledge.md"), "# Guide\n");
    const issues: KnowledgeLintIssue[] = [];

    await lintPublicationRootResidents({
      root,
      publicationRoot: "docs/knowledge",
      generatedPaths: new Set(["docs/knowledge/index.md"]),
      issues,
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: "publication_root_unmanaged_file",
        severity: "warning",
        path: "docs/knowledge/repository/knowledge.md",
      }),
    ]);
  });

  it("reports nothing when the publication root is absent", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-publication-root-lint-"));
    roots.push(root);
    const issues: KnowledgeLintIssue[] = [];

    await lintPublicationRootResidents({
      root,
      publicationRoot: "docs/knowledge",
      generatedPaths: new Set(),
      issues,
    });

    expect(issues).toEqual([]);
  });
});
