import {
  type Query,
  type SDKUserMessage,
  type WarmQuery,
  type startup,
} from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

import { ClaudeSdkAgentClient } from "../src/index.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CONTEXT_ID = "22222222-2222-4222-8222-222222222222";
const TURN_ID = "33333333-3333-4333-8333-333333333333";

function fakeSdk(options: { alterReplay?: boolean } = {}) {
  const state = {
    startupParams: undefined as Parameters<typeof startup>[0] | undefined,
    interrupted: false,
    warmClosed: false,
  };
  const sdkStartup: typeof startup = async (params) => {
    state.startupParams = params;
    const warm = {
      query(input: string | AsyncIterable<SDKUserMessage>) {
        if (typeof input === "string") throw new Error("streaming input expected");
        const generator = (async function* () {
          yield {
            type: "system",
            subtype: "init",
            session_id: SESSION_ID,
            uuid: "44444444-4444-4444-8444-444444444444",
          };
          for await (const message of input) {
            const replay = structuredClone(message) as SDKUserMessage & { isReplay: true };
            replay.isReplay = true;
            if (options.alterReplay === true) {
              replay.message = { role: "user", content: "provider changed the input" };
            }
            yield replay;
          }
        })();
        return Object.assign(generator, {
          interrupt: async () => {
            state.interrupted = true;
            return undefined;
          },
        }) as unknown as Query;
      },
      close() {
        state.warmClosed = true;
      },
      async [Symbol.asyncDispose]() {},
    } satisfies WarmQuery;
    return warm;
  };
  return { state, sdkStartup };
}

function clientOptions() {
  return {
    providerSessionId: SESSION_ID,
    cwd: "/repo",
    permissionMode: "plan" as const,
    requestTimeoutMs: 1_000,
    createMessageId: () => CONTEXT_ID,
  };
}

describe("Claude Agent SDK client", () => {
  it("closes a pre-warmed process without starting a model query", async () => {
    const fake = fakeSdk();
    const client = await ClaudeSdkAgentClient.connect(clientOptions(), fake.sdkStartup);
    await client.close();
    expect(fake.state.warmClosed).toBe(true);
  });

  it("lets a managed caller restrict Claude to an explicit read-only tool set", async () => {
    const fake = fakeSdk();
    const client = await ClaudeSdkAgentClient.connect(
      { ...clientOptions(), tools: ["Read", "Glob", "Grep"] },
      fake.sdkStartup,
    );

    expect(fake.state.startupParams?.options?.tools).toEqual(["Read", "Glob", "Grep"]);
    await client.close();
  });

  it("uses an isolated fail-closed SDK session and waits for exact input replays", async () => {
    const fake = fakeSdk();
    const client = await ClaudeSdkAgentClient.connect(clientOptions(), fake.sdkStartup);
    await client.appendContext("managed context secret");
    await client.startTurn(TURN_ID, "managed task secret");

    expect(fake.state.startupParams?.options).toMatchObject({
      cwd: "/repo",
      sessionId: SESSION_ID,
      permissionMode: "plan",
      settingSources: [],
      skills: [],
      strictMcpConfig: true,
      mcpServers: {},
      disallowedTools: ["Agent", "Task"],
    });
    const permission = await fake.state.startupParams?.options?.canUseTool?.(
      "Bash",
      { command: "danger" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-1",
        requestId: "request-1",
      },
    );
    expect(permission).toMatchObject({ behavior: "deny" });

    const controller = new AbortController();
    const iterator = client.messages(controller.signal)[Symbol.asyncIterator]();
    const raw = [];
    for (let index = 0; index < 3; index += 1) raw.push((await iterator.next()).value);
    controller.abort();
    await iterator.return?.();
    expect(raw[1]).toMatchObject({
      type: "user",
      isReplay: true,
      shouldQuery: false,
      uuid: CONTEXT_ID,
      session_id: SESSION_ID,
    });
    expect(raw[2]).toMatchObject({
      type: "user",
      isReplay: true,
      shouldQuery: true,
      uuid: TURN_ID,
      session_id: SESSION_ID,
    });

    await client.interrupt();
    expect(fake.state.interrupted).toBe(true);
    await client.close();
  });

  it("does not acknowledge controlled context when Claude replays different content", async () => {
    const fake = fakeSdk({ alterReplay: true });
    const client = await ClaudeSdkAgentClient.connect(clientOptions(), fake.sdkStartup);
    await expect(client.appendContext("expected context")).rejects.toMatchObject({
      code: "provider_protocol_failed",
    });
    await client.close();
  });
});
