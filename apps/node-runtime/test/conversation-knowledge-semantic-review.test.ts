import { createHash } from "node:crypto";

import type { NoCapabilityProviderJsonRunner } from "@lervo/repository-knowledge-compiler";
import { describe, expect, it, vi } from "vitest";

import {
  runConversationKnowledgeSemanticReview,
  type SemanticReviewContextDocument,
  type SemanticReviewDecision,
} from "../src/conversation-knowledge-semantic-review.js";
import type { RepositoryWorkReviewSnapshot } from "../src/repository-work-review-snapshot.js";

function hash(content: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function snapshot(after = "after\n") {
  const before = Buffer.from("before\n");
  const changed = Buffer.from(after);
  return {
    status: "ready_for_review" as const,
    changedPathCount: 1,
    totalByteCount: before.byteLength + changed.byteLength,
    paths: [
      {
        path: "README.md",
        before: {
          kind: "file" as const,
          content: before,
          contentHash: hash(before),
          executable: false,
        },
        after: {
          kind: "file" as const,
          content: changed,
          contentHash: hash(changed),
          executable: false,
        },
      },
    ],
  } satisfies Extract<RepositoryWorkReviewSnapshot, { status: "ready_for_review" }>;
}

function context(): SemanticReviewContextDocument[] {
  const content = "# Instructions\nReview repository changes against canonical documentation.\n";
  return [{ path: "AGENTS.md", role: "instruction", content, contentHash: hash(content) }];
}

const usage = {
  inputTokens: 100,
  cachedInputTokens: 0,
  outputTokens: 50,
  reasoningOutputTokens: 10,
  totalTokens: 150,
  contextWindow: 200_000,
};

function decision(overrides: Partial<SemanticReviewDecision> = {}): SemanticReviewDecision {
  return {
    schemaVersion: 1,
    classification: "canonical_change_candidate",
    rationale: "The changed behavior creates a durable obligation requiring documentation.",
    evidencePaths: ["README.md"],
    targetPaths: ["docs/product/vision.md"],
    ...overrides,
  };
}

function runner(value: unknown = decision(), provider: "codex" | "claude" = "codex") {
  const resolveObserved = vi.fn(async (_input: unknown) => ({ value, usage }));
  const openRunner = vi.fn(
    async () =>
      ({
        provider,
        resolve: async () => value,
        resolveObserved,
      }) satisfies NoCapabilityProviderJsonRunner,
  );
  return { openRunner, resolveObserved };
}

describe("conversation knowledge semantic review", () => {
  it("sends exact source and bounded canonical context only through a no-capability runner", async () => {
    const review = runner();
    const result = await runConversationKnowledgeSemanticReview({
      provider: "codex",
      snapshot: snapshot(),
      contextDocuments: context(),
      openRunner: review.openRunner,
    });
    expect(result).toMatchObject({
      provider: "codex",
      decision: decision(),
      usage,
      requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(review.openRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex",
        systemPrompt: expect.stringContaining("no-tool"),
      }),
    );
    expect(review.resolveObserved).toHaveBeenCalledWith(
      expect.objectContaining({
        untrustedSourceData: {
          source: [
            {
              path: "README.md",
              before: { kind: "file", text: "before\n" },
              after: { kind: "file", text: "after\n" },
            },
          ],
          context: context(),
        },
      }),
      undefined,
    );
  });

  it("rejects a model-suggested target outside the repository or evidence not in the source", async () => {
    for (const invalid of [
      decision({ targetPaths: ["../outside.md"] }),
      decision({ evidencePaths: ["docs/other.md"] }),
      decision({ classification: "implementation_only" }),
    ]) {
      const review = runner(invalid);
      await expect(
        runConversationKnowledgeSemanticReview({
          provider: "codex",
          snapshot: snapshot(),
          contextDocuments: context(),
          openRunner: review.openRunner,
        }),
      ).rejects.toMatchObject({ code: "review_provider_response_invalid" });
    }
  });

  it("rejects changed hashes, binary content, and oversize input before invoking a provider", async () => {
    const review = runner();
    const changedHash = snapshot();
    changedHash.paths[0]!.after.contentHash = hash("wrong");
    await expect(
      runConversationKnowledgeSemanticReview({
        provider: "codex",
        snapshot: changedHash,
        contextDocuments: context(),
        openRunner: review.openRunner,
      }),
    ).rejects.toMatchObject({ code: "review_context_invalid" });
    const binary = snapshot();
    binary.paths[0]!.after.content = Buffer.from([0xff]);
    binary.paths[0]!.after.contentHash = hash(binary.paths[0]!.after.content);
    await expect(
      runConversationKnowledgeSemanticReview({
        provider: "codex",
        snapshot: binary,
        contextDocuments: context(),
        openRunner: review.openRunner,
      }),
    ).rejects.toMatchObject({ code: "review_source_encoding_unsupported" });
    await expect(
      runConversationKnowledgeSemanticReview({
        provider: "codex",
        snapshot: snapshot("a".repeat(300_000)),
        contextDocuments: context(),
        openRunner: review.openRunner,
      }),
    ).rejects.toMatchObject({ code: "review_source_limit_exceeded" });
    expect(review.openRunner).not.toHaveBeenCalled();
  });

  it("requires the selected provider and complete usage from its isolated runner", async () => {
    const mismatch = runner(decision(), "claude");
    await expect(
      runConversationKnowledgeSemanticReview({
        provider: "codex",
        snapshot: snapshot(),
        contextDocuments: context(),
        openRunner: mismatch.openRunner,
      }),
    ).rejects.toMatchObject({ code: "review_provider_boundary_invalid" });
    expect(mismatch.resolveObserved).not.toHaveBeenCalled();

    const noUsage = runner();
    noUsage.resolveObserved.mockResolvedValueOnce({ value: decision(), usage: null as never });
    await expect(
      runConversationKnowledgeSemanticReview({
        provider: "codex",
        snapshot: snapshot(),
        contextDocuments: context(),
        openRunner: noUsage.openRunner,
      }),
    ).rejects.toMatchObject({ code: "review_usage_unavailable" });
  });
});
