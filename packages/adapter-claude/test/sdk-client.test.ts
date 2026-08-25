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

function fakeSdk(
  options: {
    alterReplay?: boolean;
    acknowledgeSyntheticWithLifecycle?: boolean;
    hangOnReturn?: boolean;
    mcpStatuses?: Array<{ name: string; status: "connected" }>;
    plugins?: Array<{ name: string; path: string; version?: string }>;
  } = {},
) {
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
            if (
              options.acknowledgeSyntheticWithLifecycle === true &&
              message.shouldQuery === false
            ) {
              yield {
                type: "command_lifecycle",
                state: "started",
                command_uuid: message.uuid,
                session_id: SESSION_ID,
                uuid: "55555555-5555-4555-8555-555555555555",
              };
              yield {
                type: "result",
                subtype: "success",
                is_error: false,
                num_turns: 0,
                session_id: SESSION_ID,
                uuid: "66666666-6666-4666-8666-666666666666",
                result: "",
                duration_ms: 0,
              };
              yield {
                type: "command_lifecycle",
                state: "completed",
                command_uuid: message.uuid,
                session_id: SESSION_ID,
                uuid: "77777777-7777-4777-8777-777777777777",
              };
              continue;
            }
            if (
              options.acknowledgeSyntheticWithLifecycle === true &&
              message.shouldQuery !== false
            ) {
              yield {
                type: "command_lifecycle",
                state: "started",
                command_uuid: message.uuid,
                session_id: SESSION_ID,
                uuid: "88888888-8888-4888-8888-888888888888",
              };
              continue;
            }
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
          ...(options.hangOnReturn === true
            ? { return: () => new Promise<never>(() => undefined) }
            : {}),
          mcpServerStatus: async () => options.mcpStatuses ?? [],
          reloadPlugins: async () => ({
            commands: [],
            agents: [],
            plugins: options.plugins ?? [],
            mcpServers: options.mcpStatuses ?? [],
            error_count: 0,
          }),
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

  it("configures isolated MCP and plugin activation and confirms their loaded state", async () => {
    const credential = "LERVO_TEST_MCP_TOKEN";
    const previous = process.env[credential];
    process.env[credential] = "secret-test-token";
    try {
      const fake = fakeSdk({
        mcpStatuses: [{ name: "research-search", status: "connected" }],
        plugins: [{ name: "reviewer", path: "/immutable/reviewer", version: "2.0.0" }],
      });
      const client = await ClaudeSdkAgentClient.connect(
        {
          ...clientOptions(),
          capabilityActivations: [
            {
              kind: "capability_activation_request",
              schemaVersion: 1,
              capabilityId: "research/search",
              capabilityKind: "mcp_server",
              version: "1.0.0",
              contentHash: `sha256:${"a".repeat(64)}`,
              runtime: {
                kind: "mcp_http",
                serverName: "research-search",
                url: "https://mcp.example.test/",
                bearerTokenCredential: credential,
                timeoutMs: 5000,
              },
            },
            {
              kind: "capability_activation_request",
              schemaVersion: 1,
              capabilityId: "plugins/reviewer",
              capabilityKind: "provider_plugin",
              version: "2.0.0",
              contentHash: `sha256:${"b".repeat(64)}`,
              runtime: {
                kind: "provider_plugin",
                provider: "claude",
                pluginRoot: "/immutable/reviewer",
                pluginManifestPath: ".claude-plugin/plugin.json",
              },
            },
          ],
        },
        fake.sdkStartup,
      );
      await client.appendContext("managed context");
      await client.confirmCapabilities();

      expect(fake.state.startupParams?.options).toMatchObject({
        strictMcpConfig: true,
        settingSources: [],
        mcpServers: {
          "research-search": {
            type: "http",
            url: "https://mcp.example.test/",
            headers: { Authorization: "Bearer secret-test-token" },
            alwaysLoad: true,
          },
        },
        plugins: [{ type: "local", path: "/immutable/reviewer", skipMcpDiscovery: true }],
      });
      await client.close();
    } finally {
      if (previous === undefined) delete process.env[credential];
      else process.env[credential] = previous;
    }
  });

  it("preserves a missing MCP credential as an activation failure", async () => {
    const credential = "LERVO_TEST_MISSING_MCP_TOKEN";
    const previous = process.env[credential];
    delete process.env[credential];
    try {
      await expect(
        ClaudeSdkAgentClient.connect(
          {
            ...clientOptions(),
            capabilityActivations: [
              {
                kind: "capability_activation_request",
                schemaVersion: 1,
                capabilityId: "research/private-search",
                capabilityKind: "mcp_server",
                version: "1.0.0",
                contentHash: `sha256:${"c".repeat(64)}`,
                runtime: {
                  kind: "mcp_http",
                  serverName: "private-search",
                  url: "https://mcp.example.test/",
                  bearerTokenCredential: credential,
                  timeoutMs: 5_000,
                },
              },
            ],
          },
          fakeSdk().sdkStartup,
        ),
      ).rejects.toMatchObject({
        code: "capability_activation_failed",
      });
    } finally {
      if (previous !== undefined) process.env[credential] = previous;
    }
  });

  it("accepts and suppresses the SDK lifecycle acknowledgement for synthetic context", async () => {
    const fake = fakeSdk({ acknowledgeSyntheticWithLifecycle: true });
    const client = await ClaudeSdkAgentClient.connect(clientOptions(), fake.sdkStartup);
    await client.appendContext("managed context secret");
    await client.startTurn(TURN_ID, "managed task secret");

    const controller = new AbortController();
    const iterator = client.messages(controller.signal)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "system", subtype: "init" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "command_lifecycle", state: "started", command_uuid: TURN_ID },
    });
    controller.abort();
    await iterator.return?.();
    await client.close();
  });

  it("gates Write with the managed pre/post tool hooks", async () => {
    const fake = fakeSdk();
    const client = await ClaudeSdkAgentClient.connect(
      { ...clientOptions(), permissionMode: "default", tools: ["Read", "Write", "Edit"] },
      fake.sdkStartup,
    );
    const calls: string[] = [];
    client.attachToolUseHandler({
      authorize: async () => {
        calls.push("authorize");
        return true;
      },
      complete: async (_toolName, _input, _toolUseId, status) => {
        calls.push(status);
      },
    });
    const pre = fake.state.startupParams?.options?.hooks?.PreToolUse?.[0]?.hooks[0];
    const post = fake.state.startupParams?.options?.hooks?.PostToolUse?.[0]?.hooks[0];
    if (pre === undefined || post === undefined) throw new Error("managed hooks missing");
    const base = {
      session_id: SESSION_ID,
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/repo",
      permission_mode: "default" as const,
    };
    const preResult = await pre(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: "/repo/src/a.ts", content: "secret" },
        tool_use_id: "tool-write-1",
      },
      "tool-write-1",
      { signal: new AbortController().signal },
    );
    await post(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: { file_path: "/repo/src/a.ts", content: "secret" },
        tool_response: { ok: true },
        tool_use_id: "tool-write-1",
      },
      "tool-write-1",
      { signal: new AbortController().signal },
    );

    expect(preResult).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
    expect(calls).toEqual(["authorize", "completed"]);
    await client.close();
  });

  it("preserves a managed bridge failure instead of relabeling it as a provider failure", async () => {
    const fake = fakeSdk();
    const client = await ClaudeSdkAgentClient.connect(
      { ...clientOptions(), permissionMode: "default", tools: ["Read", "Write"] },
      fake.sdkStartup,
    );
    const bridgeFailure = new Error("managed bridge failed");
    client.attachToolUseHandler({
      authorize: async () => {
        throw bridgeFailure;
      },
      complete: async () => undefined,
    });
    const pre = fake.state.startupParams?.options?.hooks?.PreToolUse?.[0]?.hooks[0];
    if (pre === undefined) throw new Error("managed pre hook missing");
    const invocation = pre(
      {
        session_id: SESSION_ID,
        transcript_path: "/tmp/transcript.jsonl",
        cwd: "/repo",
        permission_mode: "default",
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: "/repo/src/a.ts", content: "secret" },
        tool_use_id: "tool-write-failed",
      },
      "tool-write-failed",
      { signal: new AbortController().signal },
    );

    await expect(invocation).rejects.toBe(bridgeFailure);
    const iterator = client.messages(new AbortController().signal)[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBe(bridgeFailure);
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

  it("bounds SDK shutdown and aborts a query that never returns", async () => {
    const fake = fakeSdk({ hangOnReturn: true });
    const client = await ClaudeSdkAgentClient.connect(
      { ...clientOptions(), requestTimeoutMs: 10 },
      fake.sdkStartup,
    );
    await client.appendContext("managed context");

    await expect(client.close()).rejects.toMatchObject({ code: "provider_process_failed" });
    expect(fake.state.startupParams?.options?.abortController?.signal.aborted).toBe(true);
  });
});
