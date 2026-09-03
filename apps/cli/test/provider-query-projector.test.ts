import {
  canonicalHash,
  sha256 as searchSha256,
  type SearchQueryProjectionRequest,
} from "@lervo/search";
import { describe, expect, it, vi } from "vitest";

import {
  createProcessSearchQueryProjector,
  prepareProductionSearchQueries,
  projectProductionSearchQueries,
} from "../src/provider-query-projector.js";

function request(): SearchQueryProjectionRequest {
  const context = {
    currentWorkstream: {
      references: ["docs/decisions/search/engines/0308-require-multi-signal-evidence.md"],
    },
  };
  const value = "v2를 통과 수준으로 끌어올려줘";
  return {
    request: value,
    requestDigest: searchSha256(value),
    context,
    contextDigest: canonicalHash(context),
    contextAnchors: ["docs/decisions/search/engines/0308-require-multi-signal-evidence.md"],
    requestedLanguage: "en",
  };
}

describe.each(["codex", "claude"] as const)("%s query projector adapter", (provider) => {
  it("returns the same provider-neutral receipt contract without retaining private text", async () => {
    const resolve = vi.fn(async (_input: unknown) => ({
      schemaVersion: 1,
      retrievalQueries: [
        "lexical v2 activation qualification evidence",
        "docs decisions search engines 0308 require multi signal evidence",
      ],
    }));
    const createRunner = vi.fn(async () => ({
      provider,
      resolve,
      resolveObserved: async (input: unknown) => ({
        value: await resolve(input),
        usage: {
          inputTokens: 100,
          cachedInputTokens: 40,
          outputTokens: 20,
          reasoningOutputTokens: 0,
          totalTokens: 120,
          contextWindow: 200_000,
        },
      }),
    }));
    const projector = createProcessSearchQueryProjector(provider, {
      createRunner,
      now: (() => {
        let value = 10;
        return () => value++;
      })(),
    });

    const projection = await projector.project(request());

    expect(projection.receipt).toMatchObject({
      stageId: "query_projection",
      status: "completed",
      projectedQueryCount: 3,
      usage: { totalTokens: 120 },
      privacy: {
        requestText: "excluded",
        contextText: "excluded",
        projectedQueryText: "excluded",
      },
    });
    expect(projection.receipt.projector.id).toBe(`provider_query_projection.${provider}`);
    expect(JSON.stringify(projection.receipt)).not.toContain("v2를");
    expect(createRunner).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("fails closed on provider errors and reuses one verified runner", async () => {
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce({
        schemaVersion: 1,
        retrievalQueries: ["lexical v2 activation qualification evidence"],
      });
    const createRunner = vi.fn(async () => ({ provider, resolve }));
    const projector = createProcessSearchQueryProjector(provider, { createRunner });

    const failed = await projector.project(request());
    const recovered = await projector.project(request());

    expect(failed).toMatchObject({ queries: [], receipt: { status: "failed" } });
    expect(recovered.receipt.status).toBe("completed");
    expect(createRunner).toHaveBeenCalledTimes(1);
  });

  it("rejects caller digest mismatches before invoking the provider", async () => {
    const createRunner = vi.fn(async () => ({
      provider,
      resolve: async () => ({
        schemaVersion: 1,
        retrievalQueries: [],
      }),
    }));
    const projector = createProcessSearchQueryProjector(provider, { createRunner });

    await expect(
      projector.project({ ...request(), requestDigest: `sha256:${"0".repeat(64)}` }),
    ).rejects.toThrow("privacy digests");
    expect(createRunner).not.toHaveBeenCalled();
  });

  it("fails closed when native output exceeds the common query bounds", async () => {
    const projector = createProcessSearchQueryProjector(provider, {
      createRunner: async () => ({
        provider,
        resolve: async () => ({
          schemaVersion: 1,
          retrievalQueries: Array.from({ length: 9 }, (_, index) => `query ${index}`),
        }),
      }),
    });

    await expect(projector.project(request())).resolves.toMatchObject({
      queries: [],
      receipt: { status: "failed" },
    });
  });

  it("bounds generated queries before adding approved context anchors", async () => {
    const projector = createProcessSearchQueryProjector(provider, {
      createRunner: async () => ({
        provider,
        resolve: async () => ({
          schemaVersion: 1,
          retrievalQueries: Array.from({ length: 8 }, (_, index) => `generated query ${index}`),
        }),
      }),
    });

    const projection = await projector.project(request());

    expect(projection.receipt.status).toBe("completed");
    expect(projection.queries).toHaveLength(8);
    expect(projection.queries.at(-1)).toBe(
      "docs/decisions/search/engines/0308-require-multi-signal-evidence.md",
    );
  });

  it("content-binds the provider runtime admission contract into the projector build", () => {
    const runner = {
      provider,
      resolve: async () => ({ schemaVersion: 1, retrievalQueries: [] }),
    };
    const processBuild = createProcessSearchQueryProjector(provider, {
      runner,
      runtimeContract: "process_per_observation.v1",
    });
    const admittedBuild = createProcessSearchQueryProjector(provider, {
      runner,
      runtimeContract: `${provider}.admitted.v1`,
    });

    expect(processBuild.projector.buildId).not.toBe(admittedBuild.projector.buildId);
  });

  it("closes the admitted runner after one production projection", async () => {
    const close = vi.fn(async () => undefined);
    const projector = createProcessSearchQueryProjector(provider, {
      runner: {
        provider,
        resolve: async () => ({
          schemaVersion: 1,
          retrievalQueries: ["lexical v2 activation qualification evidence"],
        }),
      },
      runtimeContract: `${provider}.admitted.v1`,
    });

    await expect(
      projectProductionSearchQueries({ ...request(), provider }, async () => ({
        projectSearchQueries: (input) => projector.project(input),
        close,
      })),
    ).resolves.toMatchObject({ receipt: { status: "completed" } });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the admitted runner when production projection throws", async () => {
    const close = vi.fn(async () => undefined);
    const error = new Error("projection interrupted");

    await expect(
      projectProductionSearchQueries({ ...request(), provider }, async () => ({
        projectSearchQueries: async () => {
          throw error;
        },
        close,
      })),
    ).rejects.toBe(error);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("binds a prepared production owner to one provider", async () => {
    const close = vi.fn(async () => undefined);
    const projector = createProcessSearchQueryProjector(provider, {
      runner: {
        provider,
        resolve: async () => ({ schemaVersion: 1, retrievalQueries: [] }),
      },
    });
    const prepared = await prepareProductionSearchQueries(provider, async () => ({
      projector,
      runtimeContract:
        provider === "codex"
          ? "codex.persistent_isolated_thread_direct.v1"
          : "claude.serialized_process_direct.v1",
      close,
    }));
    try {
      await expect(
        prepared.projectSearchQueries({
          ...request(),
          provider: provider === "codex" ? "claude" : "codex",
        }),
      ).rejects.toThrow("does not match");
    } finally {
      await prepared.close();
    }
    expect(close).toHaveBeenCalledTimes(1);
  });
});
