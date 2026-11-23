import { describe, expect, it, vi } from "vitest";

import {
  prepareDirectProviderQueryRunner,
  type ProviderQueryRunnerDependencies,
} from "../src/provider-query-runner.js";
import { providerOutputSchema } from "@lervo/schemas";
import { DEFAULT_MODEL_SELECTION, type ModelSelection } from "@lervo/execution-contract";

describe.each(["codex", "claude"] as const)("%s direct query runner", (provider) => {
  it("opens a capability-free boundary without a diagnostic model turn", async () => {
    const resolveObserved = vi.fn(async () => ({
      value: { schemaVersion: 1, retrievalQueries: ["query"] },
      usage: null,
    }));
    const close = vi.fn(async () => undefined);
    const dependencies: ProviderQueryRunnerDependencies = {
      createCodexRunner: vi.fn(async () => ({
        runner: { provider: "codex" as const, resolve: vi.fn(), resolveObserved },
        runtimeContract: "codex.persistent_isolated_thread.v1" as const,
        close,
      })),
      createSerializedRunner: vi.fn(async () => ({
        provider: "claude" as const,
        resolve: vi.fn(),
        resolveObserved,
      })),
    };

    const prepared = await prepareDirectProviderQueryRunner(
      provider,
      { systemPrompt: "Return JSON only.", timeoutMs: 20_000 },
      dependencies,
    );

    expect(resolveObserved).not.toHaveBeenCalled();
    expect(prepared.runtimeContract).toBe(
      provider === "codex"
        ? "codex.persistent_isolated_thread_direct.v1"
        : "claude.serialized_process_direct.v1",
    );
    await prepared.runner.resolveObserved?.({
      responseContract: { schemaVersion: 1, schema: providerOutputSchema({ type: "object" }) },
    });
    expect(resolveObserved).toHaveBeenCalledTimes(1);
    await prepared.close();
    expect(close).toHaveBeenCalledTimes(provider === "codex" ? 1 : 0);
  });
});

describe.each(["codex", "claude"] as const)(
  "%s query runner and the background role",
  (provider) => {
    const runner = { provider, resolve: vi.fn(), resolveObserved: vi.fn() };
    const dependencies = (roles: ModelSelection["roles"]): ProviderQueryRunnerDependencies => ({
      createCodexRunner: vi.fn(async () => ({
        runner: { ...runner, provider: "codex" as const },
        runtimeContract: "codex.persistent_isolated_thread.v1" as const,
        close: vi.fn(async () => undefined),
      })),
      createSerializedRunner: vi.fn(async () => runner),
      readSelection: async () => ({ ...DEFAULT_MODEL_SELECTION, revision: 1, roles }),
    });
    const options = { systemPrompt: "Return JSON only.", timeoutMs: 20_000 };
    const other = provider === "codex" ? "claude" : "codex";

    it("answers no query when the role lists only another provider (ADR-0612)", async () => {
      const used = dependencies({
        background: [{ provider: other, model: null, reasoningEffort: null }],
      });
      await expect(prepareDirectProviderQueryRunner(provider, options, used)).rejects.toMatchObject(
        {
          code: "provider_not_admitted",
        },
      );
      expect(used.createCodexRunner).not.toHaveBeenCalled();
      expect(used.createSerializedRunner).not.toHaveBeenCalled();
    });

    it("keeps the qualified projector's default model when the role lists the provider", async () => {
      const used = dependencies({
        background: [{ provider, model: "small-model", reasoningEffort: "medium" }],
      });
      await prepareDirectProviderQueryRunner(provider, options, used);
      const created =
        provider === "codex"
          ? vi.mocked(used.createCodexRunner).mock.calls[0]![0]
          : vi.mocked(used.createSerializedRunner).mock.calls[0]![0];
      expect(created).not.toHaveProperty("model");
      expect(created).not.toHaveProperty("reasoningEffort");
    });
  },
);
