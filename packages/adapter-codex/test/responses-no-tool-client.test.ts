import { describe, expect, it } from "vitest";

import { CodexResponsesNoToolClient } from "../src/index.js";

describe("Codex Responses no-tool client", () => {
  it("fails a turn when the provider returns any non-message output", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = new CodexResponsesNoToolClient({
      apiKey: "fixture-key",
      model: "codex-fixture",
      requestTimeoutMs: 1_000,
      createId: (() => {
        let sequence = 0;
        return () => `fixture${++sequence}`;
      })(),
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            id: "resp_fixture_01",
            status: "completed",
            output: [
              {
                type: "function_call",
                id: "call_fixture_01",
                name: "unexpected_tool",
                arguments: "{}",
              },
            ],
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              total_tokens: 2,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    expect(client.inspectProcess()).toEqual({
      status: "unobservable",
      evidence: "no_managed_process",
    });
    const thread = await client.startThread({
      cwd: "/repo",
      approvalPolicy: "never",
      sandbox: "read-only",
      baseInstructions: "bounded evidence base",
    });
    await client.injectItems(thread.threadId, [
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "bounded context" }],
      },
    ]);
    const turn = await client.startTurn(thread.threadId, "select evidence", {
      reasoningEffort: "low",
    });
    const controller = new AbortController();
    const iterator = client.notifications(controller.signal)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { method: "thread/started" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { method: "turn/started" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: {
        method: "turn/completed",
        params: { turn: { id: turn.turnId, status: "failed" } },
      },
    });
    expect(requests).toEqual([
      expect.objectContaining({
        tools: [],
        tool_choice: "none",
        store: false,
        reasoning: { effort: "low" },
        input: expect.arrayContaining([expect.objectContaining({ role: "developer" })]),
      }),
    ]);

    controller.abort();
    await iterator.return?.();
    await client.unsubscribe(thread.threadId);
    await client.close();
  });
});
