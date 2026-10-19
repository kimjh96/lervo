import { prepareContext } from "@lervo/context";
import { NativeChatConversationAdapter } from "@lervo/adapter-native-chat";
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
    expect(context.preparationQuality).toMatchObject({
      retrieval: "completed",
      sourceSnapshotId: null,
      loading: "unobserved",
      fullCount: null,
      corpusCoverage: "incomplete",
      reasonCodes: ["corpus_incomplete", "loading_unobserved"],
      delivery: "unobserved",
    });
    expect(
      context.additionalCandidates.every((candidate) => candidate.source !== "knowledge"),
    ).toBe(true);
  });

  it("uses the same preparation contract for a normalized native-chat event", async () => {
    const input = await fixture();
    const adapter = new NativeChatConversationAdapter({
      integrationId: "itg_native001",
      instanceIdentity: "context-quality-fixture",
      delivery: {
        send: async () => {
          throw new Error("Read-only preparation must not send.");
        },
      },
    });
    const event = adapter.normalizeInbound({
      sourceEventKey: "native-context-quality",
      target: { projectId: input.projectId, conversationId: "cnv_general01", threadId: null },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_human001", roleId: null },
      content: {
        ...input.event.content,
        artifactId: "art_message01",
        mediaType: "text/plain; charset=utf-8",
      },
      occurredAt: "2026-10-09T00:00:00Z",
    });
    const rulePath = `docs/instructions/generated/rule_${"e".repeat(24)}.md`;
    await mkdir(resolve(input.repositoryRoot, "docs/instructions/generated"), { recursive: true });
    await writeFile(
      resolve(input.repositoryRoot, rulePath),
      "# Current rule\nPreserve operative clauses.\n## Exceptions\nKeep quoted text unchanged.\n",
    );
    input.baseRole.contextPolicy.requiredDocumentRuleIds = ["repository.instructions"];
    const existing = await prepareConversationRepositoryContext(input);
    const native = await prepareConversationRepositoryContext({ ...input, event });
    expect(native.preparationQuality).toEqual(existing.preparationQuality);
    expect(native.additionalCandidates).toEqual(existing.additionalCandidates);
    const prepared = await Promise.all(
      [existing, native].map((context) =>
        prepareContext({
          ...context,
          repositoryRoot: input.repositoryRoot,
          registry: input.registry,
          coordinates: {
            projectId: input.projectId,
            runId: input.runId,
            sessionId: "ses_native001",
            roleId: context.role.roleId,
          },
          expectedPaths: [],
          publications: [],
          handoffs: [],
          sourceRevision: "fixture-current",
          policyVersion: `sha256:${"a".repeat(64)}`,
          recordedAt: new Date(),
        }),
      ),
    );
    const clauses = prepared.map((context) =>
      Buffer.from(context.documents.find((document) => document.path === rulePath)!.bytes).toString(
        "utf8",
      ),
    );
    expect(clauses[0]).toBe(clauses[1]);
    expect(clauses[0]).toContain("Keep quoted text unchanged.");
    expect(native.preparationQuality).toMatchObject({
      loading: "unobserved",
      artifactCompliance: "unobserved",
    });
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
