import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import { CodexStdioAppServerClient } from "../src/index.js";
import { codexStoredLoginEnvironment } from "../src/index.js";
import { providerOutputSchema } from "@lervo/schemas";

/**
 * The CI test input recorder's own variables (ADR-0565), when a ledger is being recorded. A child
 * started with an explicit environment keeps them, so the recorder observes it; nothing else of
 * the parent environment reaches the child.
 */
function testInputRecorderEnvironment(): Record<string, string> {
  if (process.env.LERVO_CI_TEST_LEDGER_DIRECTORY === undefined) return {};
  return Object.fromEntries(
    ["NODE_OPTIONS", "LERVO_CI_TEST_LEDGER", "LERVO_CI_TEST_LEDGER_DIRECTORY", "LERVO_CI_TEST_FILE"]
      .map((key) => [key, process.env[key]])
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

describe("Codex stdio app-server client", () => {
  it("uses the selected stored-login environment without parent credentials", async () => {
    const previous = process.env.LERVO_TEST_INHERITED_CREDENTIAL;
    process.env.LERVO_TEST_INHERITED_CREDENTIAL = "fixture-secret";
    try {
      const client = await CodexStdioAppServerClient.connect({
        executable: process.execPath,
        commandArguments: [
          join(import.meta.dirname, "fixtures/fake-app-server.mjs"),
          "--require-isolated-profile",
        ],
        cwd: process.cwd(),
        requestTimeoutMs: 1000,
        environment: {
          ...codexStoredLoginEnvironment({
            homeDirectory: "/fixture/owner-home",
            configurationDirectory: "/fixture/owner-config",
          }),
          ...testInputRecorderEnvironment(),
        },
      });
      await client.close();
    } finally {
      if (previous === undefined) delete process.env.LERVO_TEST_INHERITED_CREDENTIAL;
      else process.env.LERVO_TEST_INHERITED_CREDENTIAL = previous;
    }
  });
  it("performs the initialize handshake and preserves the JSONL notification stream", async () => {
    const client = await CodexStdioAppServerClient.connect({
      executable: process.execPath,
      commandArguments: [join(import.meta.dirname, "fixtures/fake-app-server.mjs")],
      cwd: process.cwd(),
      requestTimeoutMs: 1_000,
    });
    expect(client.inspectProcess()).toEqual({
      status: "running",
      evidence: "owned_process_state",
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
      reasoningEffort: "low",
      outputSchema: providerOutputSchema({
        type: "object",
        properties: { evidenceTokens: { type: "array", items: { type: "string" } } },
        required: ["evidenceTokens"],
        additionalProperties: false,
      }),
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
    expect(thread).toEqual({
      threadId: "thread-stdio-1",
      model: "codex-observed-fixture",
    });
    expect(turn).toEqual({ turnId: "turn-stdio-1" });
    await client.unsubscribe(thread.threadId);
    await client.close();
    expect(client.inspectProcess()).toEqual({
      status: "exited",
      evidence: "owned_process_state",
    });
  });

  it("makes the current Node runtime discoverable to a provider child", async () => {
    const previousPath = process.env.PATH;
    process.env.PATH = ["/fixture/system-a", "/fixture/system-b"].join(delimiter);
    try {
      const client = await CodexStdioAppServerClient.connect({
        executable: process.execPath,
        commandArguments: [
          join(import.meta.dirname, "fixtures/fake-app-server.mjs"),
          "--require-runtime-path",
        ],
        cwd: process.cwd(),
        requestTimeoutMs: 1_000,
      });
      await client.close();
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it.each([
    {
      argument: "--reject-thread-start",
      failureKind: "server_rejected",
      transportCode: -32000,
    },
    {
      argument: "--ignore-thread-start",
      failureKind: "response_timeout",
      transportCode: null,
    },
    {
      argument: "--exit-on-thread-start",
      failureKind: "process_exited",
      transportCode: null,
    },
  ])("retains bounded $failureKind diagnostics without a server error body", async (scenario) => {
    const client = await CodexStdioAppServerClient.connect({
      executable: process.execPath,
      commandArguments: [
        join(import.meta.dirname, "fixtures/fake-app-server.mjs"),
        scenario.argument,
      ],
      cwd: process.cwd(),
      requestTimeoutMs: 200,
    });
    try {
      await expect(
        client.startThread({ cwd: process.cwd(), approvalPolicy: "never", sandbox: "read-only" }),
      ).rejects.toMatchObject({
        code:
          scenario.failureKind === "process_exited"
            ? "provider_process_failed"
            : "provider_protocol_failed",
        providerFailureDiagnostic: {
          provider: "codex",
          operation: "session_start",
          failureKind: scenario.failureKind,
          transportCode: scenario.transportCode,
        },
      });
    } finally {
      await client.close();
    }
  });
});
