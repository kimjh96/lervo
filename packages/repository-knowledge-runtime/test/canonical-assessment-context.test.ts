import { expect, it } from "vitest";
import { selectCanonicalAssessmentContext } from "../src/canonical-assessment-context.js";

it("retains every bounded review document for assessment and independent review", () => {
  const context = [
    { path: "AGENTS.md", role: "instruction" as const },
    ...Array.from({ length: 8 }, (_, index) => ({
      path: `docs/reference-${index}.md`,
      role: "canonical_candidate" as const,
    })),
    { path: "nested/AGENTS.md", role: "instruction" as const },
  ].map((item) => ({ ...item, contentHash: `hash:${item.path}`, content: item.path }));
  expect(selectCanonicalAssessmentContext(context).documents.map((item) => item.path)).toEqual([
    "AGENTS.md",
    "nested/AGENTS.md",
    "docs/reference-0.md",
    "docs/reference-1.md",
    "docs/reference-2.md",
    "docs/reference-3.md",
    "docs/reference-4.md",
    "docs/reference-5.md",
    "docs/reference-6.md",
    "docs/reference-7.md",
  ]);
});

it("keeps every linked contract the loader kept beside fifteen instructions", async () => {
  const { mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { dirname, resolve } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const { loadCanonicalReviewContext } = await import("@lervo/repository-context");
  const { defaultRepositoryKnowledgePolicy, serializeRepositoryKnowledgePolicy } =
    await import("@lervo/repository-knowledge");
  const root = await mkdtemp(resolve(tmpdir(), "lervo-assessment-context-"));
  const file = async (path: string, content: string) => {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), content);
    return `sha256:${createHash("sha256").update(content).digest("hex")}`;
  };
  try {
    await file(
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await file("AGENTS.md", "# Repository\n");
    for (let index = 0; index < 14; index += 1)
      await file(
        `docs/instructions/generated/rule_${String(index).padStart(24, "0")}.md`,
        `# Rule ${index}\n\nKeep rule ${index}.\n`,
      );
    const hits: { path: string; contentHash: string }[] = [];
    for (let index = 0; index < 30; index += 1) {
      const path = `docs/candidate-${index}.md`;
      hits.push({
        path,
        contentHash: await file(
          path,
          `# C${index}\n\n[contract](candidate-${index}/contract.md)\n`,
        ),
      });
      await file(`docs/candidate-${index}/contract.md`, "# Contract\n");
    }
    const context = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: ["docs/guide.md"],
      queryKnowledge: async () => ({ hits }),
    });
    const selection = selectCanonicalAssessmentContext(context);
    expect(context.filter((document) => document.role === "instruction")).toHaveLength(15);
    expect(context.some((document) => document.path.endsWith("/contract.md"))).toBe(true);
    // Nothing the loader kept is cut, so no linked contract disappears.
    expect(selection.documents).toEqual(context);
    expect(selection.skipped).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
