import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  defaultRepositoryKnowledgePolicy,
  serializeRepositoryKnowledgePolicy,
} from "@lervo/repository-knowledge";
import {
  loadCanonicalReviewContext,
  type ReviewContextSkip,
} from "../src/knowledge-review-context.js";
import { assertCanonicalReviewContextCurrent } from "../src/knowledge-review-context-fence.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-optional-context-"));
  roots.push(root);
  await mkdir(resolve(root, ".lervo/knowledge"), { recursive: true });
  await mkdir(resolve(root, "docs"));
  await writeFile(
    resolve(root, ".lervo/knowledge/policy.yaml"),
    serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
  );
  await writeFile(resolve(root, "AGENTS.md"), "# Instructions\n\nPreserve the owner's content.\n");
  await writeFile(
    resolve(root, "source.md"),
    "[Optional](docs/optional.md)\n[Good](docs/good.md)\n",
  );
  await writeFile(resolve(root, "docs/good.md"), "# Contract\n\nExact local facts.\n");
  return root;
}

it.each([
  ["oversized", "document_read_failed"],
  ["internal_symlink", "unsafe_document_path"],
  ["external_symlink", "unsafe_document_path"],
  ["missing", "document_missing"],
  ["non_utf8", "non_utf8"],
] as const)(
  "skips a %s linked document and records its closed private reason",
  async (kind, reason) => {
    const root = await repository();
    const path = resolve(root, "docs/optional.md");
    if (kind === "oversized") await writeFile(path, "x".repeat(172_973));
    if (kind === "internal_symlink") await symlink("good.md", path);
    if (kind === "external_symlink") await symlink(resolve(root, "../outside.md"), path);
    if (kind === "non_utf8") await writeFile(path, Buffer.from([0xff]));
    const skipped: ReviewContextSkip[] = [];
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: ["source.md"],
      queryKnowledge: async () => ({ hits: [] }),
      onSkipped: (item) => skipped.push(item),
    });
    expect(skipped).toContainEqual({ path: "docs/optional.md", reason });
    expect(documents.map((document) => document.path)).toEqual(["AGENTS.md", "docs/good.md"]);
    expect(() => assertCanonicalReviewContextCurrent(root, documents)).not.toThrow();
  },
);

it("skips an oversized focused query hit and keeps exact bindings for the next recommendation", async () => {
  const root = await repository();
  await writeFile(resolve(root, "docs/optional.md"), "x".repeat(172_973));
  const good = "# Contract\n\nExact local facts.\n";
  const skipped: ReviewContextSkip[] = [];
  const documents = await loadCanonicalReviewContext({
    repositoryRoot: root,
    sourcePaths: [".editorconfig"],
    onSkipped: (item) => skipped.push(item),
    queryKnowledge: async () => ({
      hits: [
        { path: "docs/optional.md", contentHash: "unused" },
        {
          path: "docs/good.md",
          contentHash: `sha256:${createHash("sha256").update(good).digest("hex")}`,
        },
      ],
    }),
  });
  expect(skipped).toContainEqual({ path: "docs/optional.md", reason: "document_read_failed" });
  expect(documents.map((document) => document.path)).toEqual(["AGENTS.md", "docs/good.md"]);
});

it("does not fail again when a source README alias supplies optional query enrichment", async () => {
  const root = await repository();
  await symlink("docs/good.md", resolve(root, "README.md"));
  const skipped: ReviewContextSkip[] = [];
  const documents = await loadCanonicalReviewContext({
    repositoryRoot: root,
    sourcePaths: ["README.md"],
    queryKnowledge: async () => ({ hits: [] }),
    onSkipped: (item) => skipped.push(item),
  });
  expect(documents.map((document) => document.path)).toEqual(["AGENTS.md"]);
  expect(skipped).toContainEqual({ path: "README.md", reason: "unsafe_document_path" });
});

it.each(["oversized", "symlink", "non_utf8"])(
  "fails closed for a %s instruction and names the path",
  async (kind) => {
    const root = await repository();
    const path = resolve(root, "AGENTS.md");
    if (kind === "oversized") await writeFile(path, "x".repeat(172_973));
    if (kind === "non_utf8") await writeFile(path, Buffer.from([0xff]));
    if (kind === "symlink") {
      await rm(path);
      await symlink("docs/good.md", path);
    }
    const skipped: ReviewContextSkip[] = [];
    await expect(
      loadCanonicalReviewContext({
        repositoryRoot: root,
        sourcePaths: ["source.md"],
        queryKnowledge: async () => ({ hits: [] }),
        onSkipped: (item) => skipped.push(item),
      }),
    ).rejects.toMatchObject({ code: "review_context_unavailable", documentPath: "AGENTS.md" });
    expect(skipped).toEqual([]);
  },
);

it("keeps a readable recommendation with stale bytes fail closed", async () => {
  const root = await repository();
  await expect(
    loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: ["source.ts"],
      queryKnowledge: async () => ({
        hits: [{ path: "docs/good.md", contentHash: `sha256:${"0".repeat(64)}` }],
      }),
    }),
  ).rejects.toMatchObject({ code: "review_context_stale", documentPath: "docs/good.md" });
});

it("bounds optional read failures while retaining required instruction bindings", async () => {
  const root = await repository();
  await writeFile(
    resolve(root, "source.md"),
    Array.from({ length: 80 }, (_, i) => `[Missing ${i}](docs/missing-${i}.md)`).join("\n"),
  );
  const skipped: ReviewContextSkip[] = [];
  const documents = await loadCanonicalReviewContext({
    repositoryRoot: root,
    sourcePaths: ["source.md"],
    queryKnowledge: async () => ({ hits: [] }),
    onSkipped: (item) => skipped.push(item),
  });
  expect(skipped.length).toBeGreaterThan(0);
  expect(skipped.length).toBeLessThanOrEqual(64);
  expect(documents.map((document) => document.path)).toEqual(["AGENTS.md"]);
});
