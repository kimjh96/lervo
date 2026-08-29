import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CodexStdioAppServerClient } from "../src/index.js";

describe("Codex stdio app-server client", () => {
  it("performs the initialize handshake and preserves the JSONL notification stream", async () => {
    const client = await CodexStdioAppServerClient.connect({
      executable: process.execPath,
      commandArguments: [join(import.meta.dirname, "fixtures/fake-app-server.mjs")],
      cwd: process.cwd(),
      requestTimeoutMs: 1_000,
    });
    const thread = await client.startThread({
      cwd: process.cwd(),
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    await client.injectItems(thread.threadId, [
      { type: "message", role: "developer", content: [{ type: "input_text", text: "context" }] },
    ]);
    await expect(client.listConnectedMcpServers(thread.threadId)).resolves.toEqual([
      "research-search",
    ]);
    const turn = await client.startTurn(thread.threadId, "fixture task", {
      outputSchema: {
        type: "object",
        properties: { evidenceTokens: { type: "array", items: { type: "string" } } },
        required: ["evidenceTokens"],
        additionalProperties: false,
      },
    });
    const controller = new AbortController();
    const iterator = client.notifications(controller.signal)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { method: "thread/started" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { method: "turn/started" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { method: "item/started" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { id: "approval-stdio-1", method: "item/fileChange/requestApproval" },
    });
    await client.respondFileChangeApproval("approval-stdio-1", "accept");
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { method: "serverRequest/resolved" },
    });
    controller.abort();
    await iterator.return?.();
    expect(thread).toEqual({ threadId: "thread-stdio-1" });
    expect(turn).toEqual({ turnId: "turn-stdio-1" });
    await client.unsubscribe(thread.threadId);
    await client.close();
  });
});
