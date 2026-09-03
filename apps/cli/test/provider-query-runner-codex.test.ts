import { describe, expect, it, vi } from "vitest";

import {
  createCodexPersistentQueryRunner,
  type CodexPersistentQueryRunnerDependencies,
} from "../src/provider-query-runner-codex.js";

const responseInput = {
  responseContract: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        schemaVersion: { const: 1 },
        retrievalQueries: { type: "array", items: { type: "string" } },
      },
      required: ["schemaVersion", "retrievalQueries"],
    },
  },
};

function dependencies(itemTypes: readonly string[] = ["agentMessage"]) {
  let thread = 0;
  let activeThread = "";
  let activeTurn = "";
  const startThread = vi.fn(async (_options: unknown) => {
    thread += 1;
    activeThread = `thread-${thread}`;
    return { threadId: activeThread };
  });
  const startTurn = vi.fn(async () => {
    activeTurn = `turn-${thread}`;
    return { turnId: activeTurn };
  });
  const close = vi.fn(async () => undefined);
  const removeDirectory = vi.fn(async () => undefined);
  const value: CodexPersistentQueryRunnerDependencies = {
    createDirectory: async () => "/tmp/lervo-query-runner-test",
    removeDirectory,
    assertNoModelTools: vi.fn(async () => undefined),
    connect: vi.fn(async () => ({
      startThread,
      startTurn,
      notifications: async function* () {
        for (const itemType of itemTypes) {
          yield {
            method: "item/completed",
            params: {
              threadId: activeThread,
              turnId: activeTurn,
              item: {
                type: itemType,
                ...(itemType === "agentMessage"
                  ? { text: '{"schemaVersion":1,"retrievalQueries":["query"]}' }
                  : {}),
              },
            },
          };
        }
        yield {
          method: "thread/tokenUsage/updated",
          params: {
            threadId: activeThread,
            turnId: activeTurn,
            tokenUsage: {
              total: {
                inputTokens: 10,
                cachedInputTokens: 2,
                outputTokens: 3,
                reasoningOutputTokens: 1,
                totalTokens: 13,
              },
              modelContextWindow: 200_000,
            },
          },
        };
        yield {
          method: "turn/completed",
          params: {
            threadId: activeThread,
            turn: { id: activeTurn, status: "completed" },
          },
        };
      },
      interruptTurn: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
      close,
    })),
  };
  return { value, startThread, startTurn, close, removeDirectory };
}

describe("Codex persistent query runner", () => {
  it("uses a fresh isolated thread for every no-capability observation", async () => {
    const fake = dependencies(["reasoning", "agentMessage"]);
    const prepared = await createCodexPersistentQueryRunner(
      { systemPrompt: "Return JSON only.", timeoutMs: 20_000 },
      fake.value,
    );

    expect(prepared.runtimeContract).toBe("codex.persistent_isolated_thread.v1");

    const first = await prepared.runner.resolveObserved!(responseInput);
    const second = await prepared.runner.resolveObserved!(responseInput);
    await prepared.close();

    expect(first).toMatchObject({ value: { schemaVersion: 1 }, usage: { totalTokens: 13 } });
    expect(second).toMatchObject({ value: { schemaVersion: 1 }, usage: { totalTokens: 13 } });
    expect(fake.startThread).toHaveBeenCalledTimes(2);
    expect(fake.startTurn).toHaveBeenCalledTimes(2);
    expect(fake.startThread.mock.calls[0]?.[0]).toMatchObject({
      approvalPolicy: "never",
      sandbox: "read-only",
      config: { features: { hooks: false }, mcp_servers: {} },
    });
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(fake.removeDirectory).toHaveBeenCalledWith("/tmp/lervo-query-runner-test");
  });

  it.each(["commandExecution", "futureItem"])(
    "rejects capability-bearing or unknown provider item %s",
    async (itemType) => {
      const fake = dependencies([itemType]);
      const prepared = await createCodexPersistentQueryRunner(
        { systemPrompt: "Return JSON only.", timeoutMs: 20_000 },
        fake.value,
      );

      await expect(prepared.runner.resolveObserved!(responseInput)).rejects.toThrow(
        "capability-bearing",
      );
      await prepared.close();
    },
  );
});
