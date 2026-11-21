import { describe, expect, it, vi } from "vitest";

import {
  prepareDirectProviderQueryRunner,
  type ProviderQueryRunnerDependencies,
} from "../src/provider-query-runner.js";
import { providerOutputSchema } from "@lervo/schemas";

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
