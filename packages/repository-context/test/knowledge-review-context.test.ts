import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  defaultRepositoryKnowledgePolicy,
  serializeRepositoryKnowledgePolicy,
} from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import { loadCanonicalReviewContext } from "../src/knowledge-review-context.js";

const roots: string[] = [];

async function fixtureFile(root: string, path: string, content: string): Promise<string> {
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(resolve(root, path), content);
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("canonical review context", () => {
  it("uses available source paths when a planned generated document is not present yet", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "Repository instructions.\n");
    await fixtureFile(root, "docs/specs/runtime.md", "# Runtime\nLocal execution.\n");
    let query = "";
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: ["docs/knowledge/documentation.md", "docs/specs/runtime.md"],
      queryKnowledge: async (input) => {
        query = input.query;
        return { hits: [] };
      },
    });
    expect(query).toContain("runtime");
    expect(documents.map((document) => document.path)).toEqual(["AGENTS.md"]);
  });

  it("keeps ranked release evidence for a pull request template source", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "Repository instructions.\n");
    await fixtureFile(
      root,
      ".github/PULL_REQUEST_TEMPLATE.md",
      [
        "## Summary",
        "## Scope and authority",
        "## Contract and architecture",
        "## Release impact",
        "A release PR never grants npm publication authority.",
        "## Verification",
        "## Knowledge and documentation",
        "## Risk and recovery",
        "## Checklist",
        "Read `docs/foundation/code-convention.md`.",
      ].join("\n"),
    );
    const releasePath = "docs/distribution/cli-version-management.md";
    const hits = [
      {
        path: releasePath,
        contentHash: await fixtureFile(
          root,
          releasePath,
          "A release PR grants no publication authority.\n",
        ),
      },
    ];
    for (let index = 0; index < 7; index += 1) {
      const path = `docs/request-${index}.md`;
      hits.push({ path, contentHash: await fixtureFile(root, path, "Unrelated request.\n") });
    }
    let query = "";
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: [".github/PULL_REQUEST_TEMPLATE.md"],
      queryKnowledge: async (input) => {
        query = input.query;
        return { hits };
      },
    });
    expect(query).toContain("github pull request template md");
    expect(query).toContain("release impact");
    expect(query).toContain("code convention");
    expect(query).toContain("npm publication");
    expect(documents.map((document) => document.path)).toContain(releasePath);
    expect(documents).toHaveLength(8);
  });

  it("loads bounded linked child contracts beyond the recommendation window", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "Repository instructions.\n");
    const parent = "docs/reproduction.md";
    const parentContent = [
      "# Reproduction",
      "[Capture](reproduction/capture.md)",
      "[Composition](reproduction/composition.md)",
      "[Invocation](reproduction/invocation.md)",
      "[Private](reproduction/secret.md)",
      "[Unrelated](../outside.md)",
      "[Remote](https://example.com/other.md)",
    ].join("\n");
    const hits: { path: string; contentHash: string }[] = [];
    hits.push({ path: parent, contentHash: await fixtureFile(root, parent, parentContent) });
    for (let index = 0; index < 6; index += 1) {
      const path = `docs/candidate-${index}.md`;
      hits.push({ path, contentHash: await fixtureFile(root, path, `Candidate ${index}.\n`) });
    }
    for (const name of ["capture", "composition", "invocation"])
      await fixtureFile(root, `docs/reproduction/${name}.md`, `# ${name}\nExact contract.\n`);
    await fixtureFile(root, "docs/reproduction/secret.md", "Private material.\n");
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: ["src/generate.mjs"],
      queryKnowledge: async () => ({ hits }),
    });
    expect(documents.map((document) => document.path)).toEqual([
      "AGENTS.md",
      parent,
      ...Array.from({ length: 6 }, (_, index) => `docs/candidate-${index}.md`),
      "docs/reproduction/capture.md",
      "docs/reproduction/composition.md",
      "docs/reproduction/invocation.md",
    ]);
    expect(documents.slice(-3).every((document) => document.role === "canonical_candidate")).toBe(
      true,
    );
  });

  it("refuses linked context above the aggregate byte bound", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "a".repeat(120 * 1024));
    const parent = "docs/reproduction.md";
    const hits = [
      {
        path: parent,
        contentHash: await fixtureFile(
          root,
          parent,
          `[Capture](reproduction/capture.md)\n${"p".repeat(120 * 1024 - 37)}`,
        ),
      },
    ];
    for (let index = 0; index < 6; index += 1) {
      const path = `docs/candidate-${index}.md`;
      hits.push({ path, contentHash: await fixtureFile(root, path, "c".repeat(120 * 1024)) });
    }
    await fixtureFile(root, "docs/reproduction/capture.md", "b".repeat(100 * 1024));
    await expect(
      loadCanonicalReviewContext({
        repositoryRoot: root,
        sourcePaths: ["src/generate.mjs"],
        queryKnowledge: async () => ({ hits }),
      }),
    ).rejects.toMatchObject({ code: "review_context_limit_exceeded" });
  });
});
