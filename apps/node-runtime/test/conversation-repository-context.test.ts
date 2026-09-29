import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan, loadDocumentRegistry } from "@lervo/project";
import { realtimeConversationWritingContract } from "@lervo/core";
import { RepositoryKnowledgeError } from "@lervo/repository-knowledge";
import type { ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import { afterEach, describe, expect, it } from "vitest";

import { prepareConversationRepositoryContext } from "../src/conversation-repository-context.js";
import { createConversationReadOnlyRole } from "../src/conversation-read-policy.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const repositoryRoot = await mkdtemp(resolve(tmpdir(), "lervo-conversation-search-"));
  roots.push(repositoryRoot);
  await writeFile(
    resolve(repositoryRoot, "README.md"),
    "# Runtime\n\nLocal execution is available.\n",
  );
  await writeFile(
    resolve(repositoryRoot, "AGENTS.md"),
    "# Instructions\n\nKeep local work safe.\n",
  );
  await applyInitPlan(
    await createInitPlan({ root: repositoryRoot, projectId: "prj_searchfallback" }),
  );
  const bytes = Buffer.from("What is the local runtime status?", "utf8");
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return {
    repositoryRoot,
    projectId: "prj_searchfallback",
    event: { content: { contentHash, byteCount: bytes.byteLength } } as ConversationInboundEvent,
    artifactStore: { get: async () => bytes } as unknown as ArtifactStore,
    registry: await loadDocumentRegistry(repositoryRoot),
    baseRole: createConversationReadOnlyRole(
      "conversation-reader",
      realtimeConversationWritingContract,
    ),
    runId: "run_searchfallback",
  };
}

describe("conversation repository context during knowledge materialization", () => {
  it("keeps operational search available without claiming a knowledge query", async () => {
    const input = await fixture();
    await mkdir(
      resolve(input.repositoryRoot, ".lervo/state/knowledge/materialization-transaction"),
      {
        recursive: true,
      },
    );
    const context = await prepareConversationRepositoryContext(input);
    expect(context.recommendationBatches).toHaveLength(1);
    expect(
      context.additionalCandidates.every((candidate) => candidate.source !== "knowledge"),
    ).toBe(true);
    expect(context.graphRecommendations).toEqual([]);
  });

  it("retains failure for other unsafe knowledge errors", async () => {
    const input = await fixture();
    await expect(
      prepareConversationRepositoryContext({
        ...input,
        knowledgeQuery: async () => {
          throw new RepositoryKnowledgeError("knowledge_source_unsafe", "Unsafe source.");
        },
      }),
    ).rejects.toMatchObject({ code: "knowledge_source_unsafe" });
  });
});
