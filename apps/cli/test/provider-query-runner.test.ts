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

describe.each(["codex", "claude"] as const)("%s query runner model route", (provider) => {
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
  const created = (used: ProviderQueryRunnerDependencies) =>
    provider === "codex"
      ? vi.mocked(used.createCodexRunner).mock.calls[0]![0]
      : vi.mocked(used.createSerializedRunner).mock.calls[0]![0];

  it("uses the background route's model and effort (ADR-0612)", async () => {
    const used = dependencies({
      background: [{ provider, model: "small-model", reasoningEffort: "medium" }],
    });
    await prepareDirectProviderQueryRunner(
      provider,
      { systemPrompt: "Return JSON only.", timeoutMs: 20_000 },
      used,
    );
    expect(created(used)).toMatchObject({ model: "small-model", reasoningEffort: "medium" });
  });

  it("keeps the provider default model and effort low when the role is unset", async () => {
    const used = dependencies({});
    await prepareDirectProviderQueryRunner(
      provider,
      { systemPrompt: "Return JSON only.", timeoutMs: 20_000 },
      used,
    );
    expect(created(used)).not.toHaveProperty("model");
    expect(created(used)).toMatchObject({ reasoningEffort: "low" });
  });
});
