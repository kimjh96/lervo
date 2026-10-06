import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadConversationKnowledgeReviewContext,
  type ConversationKnowledgeReviewContextError,
} from "../src/conversation-knowledge-review-context.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function hash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-review-context-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_review_context_01" }));
  await writeFile(resolve(root, "AGENTS.md"), "# Root instructions\n");
  return root;
}

type Query = NonNullable<
  Parameters<typeof loadConversationKnowledgeReviewContext>[0]["queryKnowledge"]
>;

function queryWith(hits: Array<{ path: string; contentHash: string; freshness: string }>): Query {
  return (async () => ({ hits })) as unknown as Query;
}

describe("conversation knowledge review context", () => {
  it("loads path-applicable instructions and exact recommended source bytes", async () => {
    const root = await fixture();
    await mkdir(resolve(root, "docs"));
    await writeFile(resolve(root, "docs/AGENTS.md"), "# Docs instructions\n");
    await writeFile(resolve(root, "docs/target.md"), "# Current target\n");
    await writeFile(resolve(root, "docs/stale.md"), "# Stale target\n");
    const documents = await loadConversationKnowledgeReviewContext({
      repositoryRoot: root,
      sourcePaths: ["docs/source.md"],
      queryKnowledge: queryWith([
        { path: "docs/target.md", contentHash: hash("# Current target\n"), freshness: "current" },
        { path: "docs/stale.md", contentHash: hash("# Stale target\n"), freshness: "stale" },
        { path: "docs/source.md", contentHash: hash("# Source\n"), freshness: "current" },
      ]),
    });
    expect(documents).toMatchObject([
      { path: "AGENTS.md", role: "instruction", content: "# Root instructions\n" },
      { path: "docs/AGENTS.md", role: "instruction", content: "# Docs instructions\n" },
      { path: "docs/target.md", role: "canonical_candidate", content: "# Current target\n" },
      { path: "docs/stale.md", role: "canonical_candidate", content: "# Stale target\n" },
    ]);
    expect(documents).toHaveLength(4);
  });

  it("refuses a recommendation whose bytes changed since query", async () => {
    const root = await fixture();
    await writeFile(resolve(root, "target.md"), "# New bytes\n");
    await expect(
      loadConversationKnowledgeReviewContext({
        repositoryRoot: root,
        sourcePaths: ["source.md"],
        queryKnowledge: queryWith([
          { path: "target.md", contentHash: hash("# Old bytes\n"), freshness: "current" },
        ]),
      }),
    ).rejects.toMatchObject({
      code: "review_context_stale",
    } satisfies Partial<ConversationKnowledgeReviewContextError>);
  });

  it("prioritizes source-adjacent documents within the bounded recommendation set", async () => {
    const root = await fixture();
    await mkdir(resolve(root, "docs/specs/knowledge"), { recursive: true });
    await writeFile(resolve(root, "docs/generic.md"), "# Generic\n");
    await writeFile(resolve(root, "docs/specs/knowledge/target.md"), "# Knowledge target\n");
    const documents = await loadConversationKnowledgeReviewContext({
      repositoryRoot: root,
      sourcePaths: ["apps/knowledge/src/source.ts"],
      queryKnowledge: queryWith([
        { path: "docs/generic.md", contentHash: hash("# Generic\n"), freshness: "current" },
        {
          path: "docs/specs/knowledge/target.md",
          contentHash: hash("# Knowledge target\n"),
          freshness: "current",
        },
      ]),
    });
    expect(documents.map((document) => document.path)).toEqual([
      "AGENTS.md",
      "docs/specs/knowledge/target.md",
      "docs/generic.md",
    ]);
  });

  it("rejects more applicable instructions than the reviewer can receive", async () => {
    const root = await fixture();
    let directory = root;
    const parts: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      parts.push(`level${index}`);
      directory = resolve(directory, `level${index}`);
      await mkdir(directory);
      await writeFile(resolve(directory, "AGENTS.md"), `# Instructions ${index}\n`);
    }
    await expect(
      loadConversationKnowledgeReviewContext({
        repositoryRoot: root,
        sourcePaths: [`${parts.join("/")}/source.md`],
        queryKnowledge: queryWith([]),
      }),
    ).rejects.toMatchObject({
      code: "review_context_limit_exceeded",
    } satisfies Partial<ConversationKnowledgeReviewContextError>);
  });
});
