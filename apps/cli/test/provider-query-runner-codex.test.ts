import { describe, expect, it, vi } from "vitest";

import {
  createCodexPersistentQueryRunner,
  type CodexPersistentQueryRunnerDependencies,
} from "../src/provider-query-runner-codex.js";
import { reviewReferences } from "@lervo/repository-knowledge";
import { providerOutputSchema } from "@lervo/schemas";

const responseInput = {
  responseContract: {
    schema: providerOutputSchema({
      type: "object",
      additionalProperties: false,
      properties: {
        schemaVersion: { const: 1 },
        retrievalQueries: { type: "array", items: { type: "string" } },
      },
      required: ["schemaVersion", "retrievalQueries"],
    }),
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

  it("refuses a schema or prompt that copies source data before any turn (ADR-0608)", async () => {
    const fake = dependencies(["agentMessage"]);
    const prepared = await createCodexPersistentQueryRunner(
      { systemPrompt: "Return JSON only.", timeoutMs: 20_000 },
      fake.value,
    );
    await expect(
      prepared.runner.resolveObserved!({
        responseContract: {
          schemaVersion: 1,
          schema: providerOutputSchema({
            type: "object",
            properties: { pick: { enum: ["kco_7f3a9c2e41b8"] } },
          }),
        },
        untrustedRequest: "Settle obligation kco_7f3a9c2e41b8.",
      }),
    ).rejects.toThrow(/offers an identifier or hash from the source data/u);
    await expect(
      prepared.runner.resolveObserved!({
        ...responseInput,
        instruction: "Echo the planHash back exactly.",
      }),
    ).rejects.toThrow(/asks to copy a hash/u);
    expect(fake.startTurn).not.toHaveBeenCalled();
    await prepared.close();
  });

  it("sends a marked path and anchor past the check, without the marks (ADR-0608)", async () => {
    const fake = dependencies(["agentMessage"]);
    const prepared = await createCodexPersistentQueryRunner(
      { systemPrompt: "Return JSON only.", timeoutMs: 20_000 },
      fake.value,
    );
    const rule = "docs/instructions/generated/rule_5d2a8f0c1e9b7a6d4c3b2a10.md";
    const anchor =
      "Pin the tool at 9c41e2f07a33b5d1e8c0a7f2b6d4e9a1c3f5b7d0 first. -> Pin the tool at its release first.";
    const documents = reviewReferences([{ path: rule }], { prefix: "d", path: (d) => d.path });
    const hunks = reviewReferences([{ anchor }], {
      prefix: "h",
      path: (h) => h.anchor,
      pathKind: "anchor",
    });
    const request = (sourcePath: unknown, anchorSchema: unknown) =>
      // The request crosses a process boundary as JSON, as a resident's runner call does.
      JSON.parse(
        JSON.stringify({
          task: "bounded_review",
          responseContract: {
            schemaVersion: 1,
            schema: providerOutputSchema({
              type: "object",
              properties: { document: documents.schema, sourcePath, anchor: anchorSchema },
            }),
          },
          untrustedSourceData: { documents: [{ document: "d1", path: rule }], anchor },
        }),
      );
    // The fake's answer does not fit this schema; only whether the turn started matters here.
    await prepared.runner.resolveObserved!(request(documents.pathSchema, hunks.pathSchema)).catch(
      () => undefined,
    );
    expect(fake.startTurn).toHaveBeenCalledTimes(1);
    const [, prompt, options] = fake.startTurn.mock.calls[0] as unknown as [
      string,
      string,
      { outputSchema: unknown },
    ];
    expect(JSON.stringify(options.outputSchema)).toContain(rule);
    expect(JSON.stringify(options.outputSchema)).not.toContain("x-lervo-ref-kind");
    expect(prompt).not.toContain("x-lervo-ref-kind");
    await expect(
      prepared.runner.resolveObserved!(request({ enum: [rule] }, { enum: [anchor] })),
    ).rejects.toThrow(/offers an identifier or hash from the source data/u);
    expect(fake.startTurn).toHaveBeenCalledTimes(1);
    await prepared.close();
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
