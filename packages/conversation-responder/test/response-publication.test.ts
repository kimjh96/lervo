import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileSystemCas } from "@lervo/cas";
import {
  adaptiveConversationWritingContract,
  realtimeConversationWritingContract,
} from "@lervo/core";

import { generatedReplyProviderClaim, publishConversationResponse } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("conversation response publication failures", () => {
  it("keeps evaluator unavailability distinct from a completed writing rejection", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-publication-"));
    roots.push(root);
    const artifacts = await FileSystemCas.open(root);
    const stored = await artifacts.put(Buffer.from("현재 모델은 Codex입니다.", "utf8"));
    const artifact = {
      artifactId: `art_${stored.contentHash.slice("sha256:".length)}`,
      uri: stored.uri,
      mediaType: "text/markdown; charset=utf-8" as const,
      contentHash: stored.contentHash,
      byteCount: stored.byteCount,
    };

    await expect(
      publishConversationResponse({
        artifact,
        writingContract: adaptiveConversationWritingContract,
        artifactStore: artifacts,
        semanticEvaluator: { evaluate: async () => Promise.reject(new Error("unavailable")) },
      }),
    ).rejects.toMatchObject({ code: "writing_evaluation_unavailable" });

    await expect(
      publishConversationResponse({
        artifact,
        writingContract: adaptiveConversationWritingContract,
        artifactStore: artifacts,
        semanticEvaluator: {
          evaluate: async (request) => ({
            evaluator: { kind: "model", evaluatorId: "fixture.semantic" },
            checks: request.checks.map((check) => ({
              checkId: check.checkId,
              status: "failed" as const,
              violationCount: 1,
            })),
          }),
        },
      }),
    ).rejects.toMatchObject({ code: "writing_publication_blocked" });
  });

  it("publishes a repaired single-provider reply when a two-provider claim is unproven", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-claim-"));
    roots.push(root);
    const artifacts = await FileSystemCas.open(root);
    const stored = await artifacts.put(
      Buffer.from("Sol thinks the rollout is safe. Opus disagrees about the timing.", "utf8"),
    );
    const candidate = await publishConversationResponse({
      artifact: {
        artifactId: `art_${stored.contentHash.slice("sha256:".length)}`,
        uri: stored.uri,
        mediaType: "text/markdown; charset=utf-8",
        contentHash: stored.contentHash,
        byteCount: stored.byteCount,
      },
      writingContract: realtimeConversationWritingContract,
      artifactStore: artifacts,
      providerClaim: generatedReplyProviderClaim({ provider: "claude" }),
    });
    expect(candidate.content.contentHash).not.toBe(stored.contentHash);
    const published = new TextDecoder().decode(
      await artifacts.get(`lervo-cas://sha256/${candidate.content.contentHash.slice(7)}`),
    );
    expect(published).toContain("Opus disagrees about the timing.");
    expect(published).not.toContain("Sol");
    expect(published).toContain("reflects the Claude provider's view only");
  });
});
