import { createHash } from "node:crypto";

import {
  createManagedWriteDecision,
  evaluateAdapterContract,
  evaluateManagedWriteContract,
  type ProviderManagedWriteBridge,
} from "@lervo/adapter-contract";
import type {
  AdapterContextEnvelope,
  AdapterManagedWriteCompletion,
  AdapterManagedWriteRequest,
  AdapterSession,
  AdapterStartRequest,
  AdapterTurnRequest,
} from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  CodexAdapter,
  CodexAdapterError,
  CodexEventNormalizer,
  CodexResponsesNoToolClient,
  type CodexAppServerClient,
  type CodexServerRequestId,
  type CodexThreadStartOptions,
  type CodexTurnStartOptions,
} from "../src/index.js";

function sha(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

class FakeCodexClient implements CodexAppServerClient {
  readonly calls: Array<{ method: string; value: unknown }> = [];
  readonly notificationsList: unknown[] = [
    {
      method: "thread/started",
      emittedAtMs: Date.parse("2026-08-18T00:00:01Z"),
      params: { thread: { id: "codex-thread-1" } },
    },
  ];
  closed = false;
  failClose = false;

  async startThread(
    options: CodexThreadStartOptions,
  ): Promise<{ threadId: string; model?: string }> {
    this.calls.push({ method: "startThread", value: options });
    return { threadId: "codex-thread-1", model: "codex-observed-model" };
  }

  async injectItems(threadId: string, items: readonly unknown[]) {
    this.calls.push({ method: "injectItems", value: { threadId, items: structuredClone(items) } });
  }

  async listConnectedMcpServers(threadId: string) {
    this.calls.push({ method: "listConnectedMcpServers", value: threadId });
    return ["research-search"];
  }

  async startTurn(threadId: string, instructions: string, options?: CodexTurnStartOptions) {
    this.calls.push({ method: "startTurn", value: { threadId, instructions, options } });
    this.notificationsList.push(
      {
        method: "turn/started",
        params: { threadId, turn: { id: "codex-turn-1" } },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          turnId: "codex-turn-1",
          completedAtMs: Date.parse("2026-08-18T00:00:04Z"),
          item: {
            type: "commandExecution",
            id: "command-1",
            command: "printf super-secret-command",
            cwd: "/repo",
            status: "completed",
            aggregatedOutput: "super-secret-output",
            exitCode: 0,
            durationMs: 12,
          },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          turnId: "codex-turn-1",
          item: {
            type: "fileChange",
            id: "change-1",
            status: "completed",
            changes: [
              {
                path: "src/index.ts",
                kind: { type: "update", move_path: null },
                diff: "super-secret-diff",
              },
            ],
          },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          turnId: "codex-turn-1",
          item: { type: "contextCompaction", id: "compact-1" },
        },
      },
      {
        method: "thread/tokenUsage/updated",
        params: {
          threadId,
          turnId: "codex-turn-1",
          tokenUsage: {
            total: {
              inputTokens: 10,
              cachedInputTokens: 2,
              outputTokens: 4,
              reasoningOutputTokens: 1,
              totalTokens: 14,
            },
            modelContextWindow: 100,
          },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          turnId: "codex-turn-1",
          item: {
            type: "agentMessage",
            id: "message-1",
            text: "super-secret-result",
          },
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId,
          turn: { id: "codex-turn-1", status: "completed", durationMs: 20 },
        },
      },
    );
    return { turnId: "codex-turn-1" };
  }

  async interruptTurn(threadId: string, turnId: string) {
    this.calls.push({ method: "interruptTurn", value: { threadId, turnId } });
  }

  async respondFileChangeApproval(requestId: CodexServerRequestId, decision: "accept" | "decline") {
    this.calls.push({ method: "respondFileChangeApproval", value: { requestId, decision } });
  }

  async unsubscribe(threadId: string) {
    this.calls.push({ method: "unsubscribe", value: threadId });
  }

  async *notifications(signal: AbortSignal): AsyncIterable<unknown> {
    let index = 0;
    while (!signal.aborted) {
      if (index < this.notificationsList.length) {
        yield structuredClone(this.notificationsList[index]);
        index += 1;
        continue;
      }
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    }
  }

  async close() {
    this.closed = true;
    this.calls.push({ method: "close", value: null });
    if (this.failClose) throw new Error("close failed");
  }
}

class NoToolFakeCodexClient extends FakeCodexClient {
  readonly toolBoundary = "no_tools" as const;

  override async startTurn(
    threadId: string,
    instructions: string,
    options?: CodexTurnStartOptions,
  ) {
    this.calls.push({ method: "startTurn", value: { threadId, instructions, options } });
    this.notificationsList.push(
      {
        method: "turn/started",
        params: { threadId, turn: { id: "codex-turn-1" } },
      },
      {
        method: "thread/tokenUsage/updated",
        params: {
          threadId,
          turnId: "codex-turn-1",
          tokenUsage: {
            total: {
              inputTokens: 10,
              cachedInputTokens: 2,
              outputTokens: 4,
              reasoningOutputTokens: 1,
              totalTokens: 14,
            },
            modelContextWindow: 100,
          },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          turnId: "codex-turn-1",
          item: { type: "agentMessage", id: "message-1", text: "super-secret-result" },
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId,
          turn: { id: "codex-turn-1", status: "completed", durationMs: 20 },
        },
      },
    );
    return { turnId: "codex-turn-1" };
  }
}

class UnobservedModelCodexClient extends FakeCodexClient {
  override async startThread(options: CodexThreadStartOptions) {
    this.calls.push({ method: "startThread", value: options });
    return { threadId: "codex-thread-1" };
  }
}

function clock() {
  let value = Date.parse("2026-08-18T00:00:01Z");
  return () => {
    const current = new Date(value);
    value += 1_000;
    return current;
  };
}

function adapter(
  client: FakeCodexClient,
  overrides: Partial<ConstructorParameters<typeof CodexAdapter>[0]> = {},
) {
  let eventSequence = 0;
  return new CodexAdapter({
    repositoryRoot: "/repo",
    clientFactory: async () => client,
    now: clock(),
    createReceiptId: () => "ctx_codex0001",
    createEventId: () => `evt_codex${String(++eventSequence).padStart(4, "0")}`,
    ...overrides,
  });
}

function fixture() {
  const agents = "All agents read this document.\n";
  const writing = "Write clear English sentences for human readers.\n";
  const taskEvidence = "The task requires the bounded architecture decision.\n";
  const startRequest: AdapterStartRequest = {
    kind: "start_request",
    schemaVersion: 1,
    adapterId: "lervo/codex",
    projectId: "prj_01234567",
    runId: "run_01234567",
    sessionId: "ses_01234567",
    roleId: "developer",
    writingPolicyId: "writing_en-human",
    requestDigest: sha("fixture request"),
    executionMode: "read_only",
    requestedAt: "2026-08-18T00:00:00Z",
  };
  const contextEnvelope: AdapterContextEnvelope = {
    kind: "context_envelope",
    schemaVersion: 1,
    envelopeId: "envelope-codex-1",
    adapterId: "lervo/codex",
    projectId: startRequest.projectId,
    runId: startRequest.runId,
    sessionId: startRequest.sessionId,
    roleId: startRequest.roleId,
    writingPolicyId: startRequest.writingPolicyId,
    writingPolicyDocumentId: "doc_writing_policy",
    targetTurnId: "turn-managed-1",
    contextGeneration: 0,
    documents: [
      {
        documentId: "doc_agents0001",
        path: "AGENTS.md",
        contentHash: sha(agents),
        byteCount: Buffer.byteLength(agents),
        scope: { kind: "full" },
        documentRole: "governance_context",
        referenceEligible: false,
        delivery: { kind: "inline", content: agents },
      },
      {
        documentId: "doc_writing_policy",
        path: ".lervo/writing.ko-KR.md",
        contentHash: sha(writing),
        byteCount: Buffer.byteLength(writing),
        scope: { kind: "full" },
        documentRole: "governance_context",
        referenceEligible: false,
        delivery: { kind: "inline", content: writing },
      },
      {
        documentId: "doc_task_evidence1",
        path: "docs/task-evidence.md",
        contentHash: sha(taskEvidence),
        byteCount: Buffer.byteLength(taskEvidence),
        scope: { kind: "full" },
        documentRole: "task_evidence",
        referenceEligible: true,
        delivery: { kind: "inline", content: taskEvidence },
      },
    ],
    createdAt: "2026-08-18T00:00:01Z",
  };
  const turnRequest: AdapterTurnRequest = {
    kind: "turn_request",
    schemaVersion: 1,
    adapterId: "lervo/codex",
    projectId: startRequest.projectId,
    runId: startRequest.runId,
    sessionId: startRequest.sessionId,
    providerSessionId: "codex-thread-1",
    targetTurnId: contextEnvelope.targetTurnId,
    instructions: "Implement a small feature.",
    requestedAt: "2026-08-18T00:00:02Z",
  };
  return { startRequest, contextEnvelope, turnRequest, agents, writing, taskEvidence };
}

async function started(adapterInstance: CodexAdapter): Promise<AdapterSession> {
  return adapterInstance.start(fixture().startRequest);
}

describe("Codex managed adapter", () => {
  it("keeps unavailable client process state explicit and session-bound", async () => {
    const instance = adapter(new FakeCodexClient());
    const session = await started(instance);

    expect(instance.inspectProcess(session)).toMatchObject({
      adapterId: session.adapterId,
      runId: session.runId,
      providerSessionId: session.providerSessionId,
      status: "unobservable",
      evidence: "transport_state_unavailable",
    });
    await instance.stop(session, {
      kind: "stop_request",
      schemaVersion: 1,
      adapterId: session.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      reason: "completed",
      requestedAt: session.startedAt,
    });
  });

  it("rejects a write-capable sandbox before starting Codex", async () => {
    const client = new FakeCodexClient();
    await expect(
      adapter(client, { sandbox: "workspace-write" }).start(fixture().startRequest),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(client.calls).toEqual([]);
  });

  it("rejects an approval policy that could leave the managed boundary", async () => {
    const client = new FakeCodexClient();
    await expect(
      adapter(client, { approvalPolicy: "on-request" }).start(fixture().startRequest),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(client.calls).toEqual([]);
  });

  it("passes the common adapter contract with a controlled turn", async () => {
    const client = new FakeCodexClient();
    const report = await evaluateAdapterContract(
      adapter(client, { baseInstructions: "bounded evidence base" }),
      {
        expectedProvider: "codex",
        ...fixture(),
        stopReason: "completed",
        expectedEventCount: 7,
        expectedResultContent: "super-secret-result",
        expectedModelIdentity: {
          provider: "codex",
          requestedModel: null,
          answerModel: "codex-observed-model",
          observedModelIds: ["codex-observed-model"],
          answerModelEvidence: "thread_start",
          unavailableReason: null,
        },
      },
    );
    expect(report).toEqual({ passed: true, violations: [] });
    expect(client.calls[0]).toMatchObject({
      method: "startThread",
      value: {
        baseInstructions: "bounded evidence base",
        config: { features: { hooks: false } },
      },
    });
    expect(client.closed).toBe(true);
  });

  it("passes the common adapter contract at the no-tool capability boundary", async () => {
    const client = new NoToolFakeCodexClient();
    const instance = adapter(client, {
      transport: {
        kind: "responses_api_no_tools",
        apiKey: "fixture-key",
        model: "codex-fixture",
      },
    });
    const report = await evaluateAdapterContract(instance, {
      expectedProvider: "codex",
      ...fixture(),
      stopReason: "completed",
      expectedEventCount: 4,
      expectedResultContent: "super-secret-result",
      expectedModelIdentity: {
        provider: "codex",
        requestedModel: "codex-fixture",
        answerModel: "codex-observed-model",
        observedModelIds: ["codex-observed-model"],
        answerModelEvidence: "thread_start",
        unavailableReason: null,
      },
    });

    expect(report).toEqual({ passed: true, violations: [] });
  });

  it("reports model identity unavailable when the provider supplies no observation", async () => {
    const report = await evaluateAdapterContract(adapter(new UnobservedModelCodexClient()), {
      expectedProvider: "codex",
      ...fixture(),
      stopReason: "completed",
      expectedEventCount: 7,
      expectedResultContent: "super-secret-result",
      expectedModelIdentity: {
        provider: "codex",
        requestedModel: null,
        answerModel: null,
        observedModelIds: [],
        answerModelEvidence: "unavailable",
        unavailableReason: "provider_model_unavailable",
      },
    });

    expect(report).toEqual({ passed: true, violations: [] });
  });

  it("binds the model returned by the Responses API instead of the requested alias", async () => {
    const client = new CodexResponsesNoToolClient({
      apiKey: "fixture-key",
      model: "codex-requested-alias",
      requestTimeoutMs: 1_000,
      createId: () => "observedfixture",
      now: clock(),
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: "resp_observed_fixture",
            status: "completed",
            model: "codex-observed-snapshot",
            output: [
              {
                type: "message",
                id: "message-observed-fixture",
                content: [{ type: "output_text", text: "observed result" }],
              },
            ],
            usage: {
              input_tokens: 2,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 1,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: 3,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    const data = fixture();
    const instance = new CodexAdapter({
      repositoryRoot: "/repo",
      transport: {
        kind: "responses_api_no_tools",
        apiKey: "fixture-key",
        model: "codex-requested-alias",
      },
      clientFactory: async () => client,
      now: clock(),
      createReceiptId: () => "ctx_codex_response",
      createEventId: (() => {
        let sequence = 0;
        return () => `evt_codex_response_${++sequence}`;
      })(),
    });
    const report = await evaluateAdapterContract(instance, {
      expectedProvider: "codex",
      ...data,
      turnRequest: {
        ...data.turnRequest,
        providerSessionId: "responses_observedfixture",
      },
      stopReason: "completed",
      expectedEventCount: 4,
      expectedResultContent: "observed result",
      expectedModelIdentity: {
        provider: "codex",
        requestedModel: "codex-requested-alias",
        answerModel: "codex-observed-snapshot",
        observedModelIds: ["codex-observed-snapshot"],
        answerModelEvidence: "response_object",
        unavailableReason: null,
      },
    });

    expect(report).toEqual({ passed: true, violations: [] });
  });

  it("passes an opt-in structured result schema to the Codex turn boundary", async () => {
    const client = new FakeCodexClient();
    const outputSchema = {
      type: "object",
      properties: { evidenceTokens: { type: "array", items: { type: "string" } } },
      required: ["evidenceTokens"],
      additionalProperties: false,
    };
    const instance = adapter(client, {
      reasoningEffort: "low",
      structuredOutputSchema: outputSchema,
    });
    const data = fixture();
    const session = await instance.start(data.startRequest);
    await instance.injectContext(session, data.contextEnvelope);

    await instance.startTurn(session, data.turnRequest, () => undefined);

    expect(client.calls.find((call) => call.method === "startTurn")).toEqual({
      method: "startTurn",
      value: {
        threadId: session.providerSessionId,
        instructions: data.turnRequest.instructions,
        options: { reasoningEffort: "low", outputSchema },
      },
    });
  });

  it("reports only the capabilities effective for the selected session mode", async () => {
    const readOnly = await started(adapter(new FakeCodexClient()));
    const managed = await adapter(new FakeCodexClient()).start({
      ...fixture().startRequest,
      executionMode: "managed_write",
    });

    expect(readOnly.effectiveCapabilities.fileChanges).toBe("unsupported");
    expect(managed.effectiveCapabilities.fileChanges).toBe("supported");
  });

  it("reports a Responses no-tool session only when its explicit transport is available", async () => {
    const client = new NoToolFakeCodexClient();
    const session = await adapter(client, {
      transport: {
        kind: "responses_api_no_tools",
        apiKey: "fixture-key",
        model: "codex-fixture",
      },
    }).start(fixture().startRequest);

    expect(session.effectiveCapabilities).toMatchObject({
      toolCalls: "unsupported",
      commandExecution: "unsupported",
      fileChanges: "unsupported",
      contextCompaction: "unsupported",
    });
  });

  it("fails before a Responses request when its explicit credentials are unavailable", async () => {
    let requests = 0;
    const instance = new CodexAdapter({
      repositoryRoot: "/repo",
      transport: {
        kind: "responses_api_no_tools",
        fetch: async () => {
          requests += 1;
          return new Response(null, { status: 500 });
        },
      },
    });

    await expect(instance.start(fixture().startRequest)).rejects.toMatchObject({
      code: "capability_activation_failed",
    });
    expect(requests).toBe(0);
  });

  it("passes exact MCP and plugin configuration and returns provider-bound activation receipts", async () => {
    const client = new FakeCodexClient();
    const instance = adapter(client);
    const data = fixture();
    const session = await instance.start({
      ...data.startRequest,
      capabilityActivations: [
        {
          kind: "capability_activation_request",
          schemaVersion: 1,
          capabilityId: "research/search",
          capabilityKind: "mcp_server",
          version: "1.0.0",
          contentHash: `sha256:${"a".repeat(64)}`,
          runtime: {
            kind: "mcp_stdio",
            serverName: "research-search",
            command: "node",
            arguments: ["/immutable/server.mjs"],
            credentialNames: [],
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
            provider: "codex",
            pluginRoot: "/immutable/reviewer",
            pluginManifestPath: ".codex-plugin/plugin.json",
          },
        },
      ],
    });
    await instance.injectContext(session, data.contextEnvelope);
    const receipts = await instance.confirmCapabilityActivation(session);

    expect(client.calls[0]).toMatchObject({
      method: "startThread",
      value: {
        config: {
          features: { hooks: false },
          mcp_servers: {
            "research-search": { command: "node", args: ["/immutable/server.mjs"], env: {} },
          },
        },
        selectedCapabilityRoots: [
          {
            id: "plugins/reviewer@2.0.0",
            location: { type: "environment", path: "/immutable/reviewer" },
          },
        ],
      },
    });
    expect(receipts.map((item) => item.evidence)).toEqual(["mcp_connected", "plugin_loaded"]);
    expect(receipts.every((item) => item.providerSessionId === session.providerSessionId)).toBe(
      true,
    );
  });

  it("binds a file-change server approval to the managed write bridge", async () => {
    class RecordingBridge implements ProviderManagedWriteBridge {
      requests: AdapterManagedWriteRequest[] = [];
      decisions: ReturnType<typeof createManagedWriteDecision>[] = [];
      completions: AdapterManagedWriteCompletion[] = [];
      async authorize(request: AdapterManagedWriteRequest) {
        this.requests.push(structuredClone(request));
        const decision = createManagedWriteDecision({
          request,
          decision: "allow",
          reasonCode: "authorized",
          decidedAt: new Date(Date.parse(request.requestedAt) + 1_000).toISOString(),
        });
        this.decisions.push(structuredClone(decision));
        return decision;
      }
      async complete(completion: AdapterManagedWriteCompletion) {
        this.completions.push(structuredClone(completion));
      }
    }
    const client = new FakeCodexClient();
    const instance = adapter(client);
    const data = fixture();
    const bridge = new RecordingBridge();
    const session = await instance.start({ ...data.startRequest, executionMode: "managed_write" });
    await instance.injectContext(session, data.contextEnvelope);
    await instance.attachManagedWriteBridge(session, bridge);
    const turn = await instance.startTurn(session, data.turnRequest, () => undefined);
    const change = {
      path: "/repo/src/index.ts",
      kind: { type: "update", move_path: null },
      diff: "secret patch",
    };
    client.notificationsList.splice(
      1,
      client.notificationsList.length,
      {
        method: "item/started",
        params: {
          threadId: session.providerSessionId,
          turnId: "codex-turn-1",
          item: {
            type: "fileChange",
            id: "change-managed",
            status: "inProgress",
            changes: [change],
          },
        },
      },
      {
        id: 99,
        method: "item/fileChange/requestApproval",
        params: {
          threadId: session.providerSessionId,
          turnId: "codex-turn-1",
          itemId: "change-managed",
          startedAtMs: Date.parse("2026-08-18T00:00:03Z"),
        },
      },
      {
        method: "item/completed",
        params: {
          threadId: session.providerSessionId,
          turnId: "codex-turn-1",
          item: {
            type: "fileChange",
            id: "change-managed",
            status: "completed",
            changes: [change],
          },
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId: session.providerSessionId,
          turn: { id: "codex-turn-1", status: "completed", durationMs: 1 },
        },
      },
    );
    const controller = new AbortController();
    const events = instance.events(session, controller.signal)[Symbol.asyncIterator]();
    while (true) {
      const next = await events.next();
      if (next.done || next.value.type === "provider.turn.completed") break;
    }
    controller.abort();
    await events.return?.();

    expect(bridge.requests).toEqual([
      expect.objectContaining({
        providerItemId: "change-managed",
        path: "src/index.ts",
        changeKind: "modified",
      }),
    ]);
    expect(bridge.completions).toEqual([
      expect.objectContaining({ providerItemId: "change-managed", status: "completed" }),
    ]);
    expect(client.calls).toContainEqual({
      method: "respondFileChangeApproval",
      value: { requestId: 99, decision: "accept" },
    });
    expect(JSON.stringify(bridge.requests)).not.toContain("secret patch");
    expect(
      evaluateManagedWriteContract({
        session,
        turn,
        request: bridge.requests[0]!,
        decision: bridge.decisions[0]!,
        completion: bridge.completions[0]!,
      }),
    ).toEqual({ passed: true, violations: [] });
  });

  it("injects exact role, writing policy, hashes and document bytes before the turn", async () => {
    const client = new FakeCodexClient();
    const instance = adapter(client);
    const data = fixture();
    const session = await instance.start(data.startRequest);
    await instance.injectContext(session, data.contextEnvelope);
    await instance.startTurn(session, data.turnRequest, () => undefined);

    const injection = client.calls.find((call) => call.method === "injectItems");
    expect(JSON.stringify(injection?.value)).toContain("lervo-e4:");
    const serialized = JSON.stringify(injection?.value);
    expect(serialized).toContain(data.agents.trim());
    expect(serialized).toContain(data.writing.trim());
    expect(serialized).toContain(data.startRequest.roleId);
    expect(serialized).toContain(data.startRequest.writingPolicyId as string);
    expect(client.calls.map((call) => call.method)).toEqual([
      "startThread",
      "injectItems",
      "startTurn",
    ]);
  });

  it("does not start a turn without the matching controlled context", async () => {
    const client = new FakeCodexClient();
    const instance = adapter(client);
    const session = await started(instance);
    await expect(
      instance.startTurn(session, fixture().turnRequest, () => undefined),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(client.calls.some((call) => call.method === "startTurn")).toBe(false);
  });

  it("rejects changed inline bytes before claiming injection", async () => {
    const client = new FakeCodexClient();
    const instance = adapter(client);
    const session = await started(instance);
    const envelope = fixture().contextEnvelope;
    envelope.documents[0]!.delivery = { kind: "inline", content: "changed source" };
    await expect(instance.injectContext(session, envelope)).rejects.toBeInstanceOf(
      CodexAdapterError,
    );
    expect(client.calls.some((call) => call.method === "injectItems")).toBe(false);
  });

  it("normalizes provider reports without retaining commands, output, diffs or absolute paths", async () => {
    const client = new FakeCodexClient();
    const instance = adapter(client);
    const data = fixture();
    const session = await instance.start(data.startRequest);
    await instance.injectContext(session, data.contextEnvelope);
    await instance.startTurn(session, data.turnRequest, () => undefined);
    const controller = new AbortController();
    const events = instance.events(session, controller.signal)[Symbol.asyncIterator]();
    const values = [];
    for (let index = 0; index < 7; index += 1) {
      const next = await events.next();
      expect(next.done).toBe(false);
      values.push(next.value!);
    }
    controller.abort();
    await events.return?.();

    expect(values.map((event) => event.type)).toEqual([
      "provider.session.started",
      "provider.turn.started",
      "provider.command.executed",
      "provider.file_change.reported",
      "provider.context.compacted",
      "provider.usage.updated",
      "provider.turn.completed",
    ]);
    const serialized = JSON.stringify(values);
    expect(serialized).not.toContain("super-secret-command");
    expect(serialized).not.toContain("super-secret-output");
    expect(serialized).not.toContain("super-secret-diff");
    expect(serialized).not.toContain("super-secret-result");
    expect(serialized).not.toContain('"/repo"');
    expect(values[3]!.type).not.toBe("file.changed");
    expect(values.find((event) => event.type === "provider.usage.updated")?.payload).toEqual({
      providerTurnId: "codex-turn-1",
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 4,
      reasoningOutputTokens: 1,
      totalTokens: 14,
      contextWindow: 100,
    });
    expect(instance.resourceAccounting).toMatchObject({
      accountingMode: "turn_cumulative",
      observationSupport: "supported",
      normalizationId: "codex_app_server_usage_v1",
    });
  });

  it("interrupts the active provider turn when a managed session is cancelled", async () => {
    const client = new FakeCodexClient();
    const instance = adapter(client);
    const data = fixture();
    const session = await instance.start(data.startRequest);
    await instance.injectContext(session, data.contextEnvelope);
    await instance.startTurn(session, data.turnRequest, () => undefined);
    await instance.stop(session, {
      kind: "stop_request",
      schemaVersion: 1,
      adapterId: "lervo/codex",
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      reason: "cancelled",
      requestedAt: "2026-08-18T00:00:04Z",
    });
    expect(client.calls.slice(-3).map((call) => call.method)).toEqual([
      "interruptTurn",
      "unsubscribe",
      "close",
    ]);
    await expect(instance.injectContext(session, data.contextEnvelope)).rejects.toMatchObject({
      code: "session_not_found",
    });
  });

  it("releases session state even when the provider close operation fails", async () => {
    const client = new FakeCodexClient();
    client.failClose = true;
    const instance = adapter(client);
    const data = fixture();
    const session = await instance.start(data.startRequest);
    const stop = instance.stop(session, {
      kind: "stop_request",
      schemaVersion: 1,
      adapterId: "lervo/codex",
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      reason: "failed",
      requestedAt: "2026-08-18T00:00:04Z",
    });

    await expect(stop).rejects.toMatchObject({ code: "provider_process_failed" });
    await expect(instance.injectContext(session, data.contextEnvelope)).rejects.toMatchObject({
      code: "session_not_found",
    });
  });

  it("marks incomplete usage as a provider error instead of inventing zero counts", async () => {
    const client = new FakeCodexClient();
    const session = await started(adapter(client));
    const normalizer = new CodexEventNormalizer({
      session,
      repositoryRoot: "/repo",
      adapterVersion: "0.1.0",
      now: () => new Date("2026-08-18T00:00:03Z"),
      createEventId: () => "evt_invalidusage",
    });
    const event = normalizer.normalize({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: session.providerSessionId,
        turnId: "codex-turn-1",
        tokenUsage: { total: { inputTokens: 10 } },
      },
    });
    expect(event).toMatchObject({
      type: "provider.error",
      payload: { failureCode: "invalid_provider_usage", retryable: false },
    });
    expect(JSON.stringify(event)).not.toContain('"outputTokens":0');
  });

  it("separates a turn that failed without an observed model from a rejected turn", async () => {
    const client = new FakeCodexClient();
    const session = await started(adapter(client));
    const normalizerFor = (observed: string | null) =>
      new CodexEventNormalizer({
        session,
        repositoryRoot: "/repo",
        adapterVersion: "0.1.0",
        now: () => new Date("2026-09-15T00:00:00Z"),
        createEventId: () => "evt_modelunavailable",
        observedModel: () => observed,
      });
    const failed = {
      method: "turn/completed",
      params: {
        threadId: session.providerSessionId,
        turn: { id: "codex-turn-9", status: "failed", error: { code: "overloaded" } },
      },
    };

    expect(normalizerFor(null).normalize(failed)).toMatchObject({
      type: "provider.turn.failed",
      payload: { failureCode: "provider_model_unavailable" },
    });
    expect(normalizerFor("gpt-6-astra").normalize(failed)).toMatchObject({
      type: "provider.turn.failed",
      payload: { failureCode: "codex_turn_failed" },
    });
    const overloaded = normalizerFor("gpt-5.6-terra");
    overloaded.normalize({
      method: "turn/started",
      params: { threadId: session.providerSessionId, turn: { id: "codex-turn-10" } },
    });
    overloaded.normalize({
      method: "error",
      params: {
        threadId: session.providerSessionId,
        error: { codexErrorInfo: "server_overloaded", message: "private provider detail" },
      },
    });
    expect(
      overloaded.normalize({
        method: "turn/completed",
        params: {
          threadId: session.providerSessionId,
          turn: { id: "codex-turn-10", status: "failed", error: { message: "private" } },
        },
      }),
    ).toMatchObject({
      type: "provider.turn.failed",
      payload: { failureCode: "provider_capacity_unavailable" },
    });
    for (const codexErrorInfo of [
      { type: "HttpConnectionFailed", httpStatusCode: 503 },
      { HttpConnectionFailed: { httpStatusCode: 503 } },
    ]) {
      expect(
        normalizerFor("gpt-5.6-terra").normalize({
          method: "turn/completed",
          params: {
            threadId: session.providerSessionId,
            turn: { id: "codex-turn-11", status: "failed", error: { codexErrorInfo } },
          },
        }),
      ).toMatchObject({
        type: "provider.turn.failed",
        payload: { failureCode: "provider_capacity_unavailable" },
      });
    }
    for (const error of [
      { codexErrorInfo: "usageLimitExceeded" },
      { codex_error_info: "usage_limit_exceeded" },
      { codexErrorInfo: { type: "UsageLimitExceeded" } },
    ]) {
      expect(
        normalizerFor("gpt-6-sol").normalize({
          method: "turn/completed",
          params: {
            threadId: session.providerSessionId,
            turn: { id: "codex-turn-15", status: "failed", error },
          },
        }),
      ).toMatchObject({
        type: "provider.turn.failed",
        payload: { failureCode: "provider_usage_limited" },
      });
    }
    const limited = normalizerFor("gpt-6-sol");
    limited.normalize({
      method: "turn/started",
      params: { threadId: session.providerSessionId, turn: { id: "codex-turn-16" } },
    });
    limited.normalize({
      method: "error",
      params: {
        threadId: session.providerSessionId,
        error: { codexErrorInfo: "usageLimitExceeded", message: "private provider detail" },
      },
    });
    expect(
      limited.normalize({
        method: "turn/completed",
        params: {
          threadId: session.providerSessionId,
          turn: { id: "codex-turn-16", status: "failed", error: { message: "private" } },
        },
      }),
    ).toMatchObject({ payload: { failureCode: "provider_usage_limited" } });
    const structuredNotification = normalizerFor("gpt-5.6-terra");
    structuredNotification.normalize({
      method: "turn/started",
      params: { threadId: session.providerSessionId, turn: { id: "codex-turn-13" } },
    });
    structuredNotification.normalize({
      method: "error",
      params: {
        threadId: session.providerSessionId,
        error: { codexErrorInfo: { type: "HttpConnectionFailed", httpStatusCode: 503 } },
      },
    });
    expect(
      structuredNotification.normalize({
        method: "turn/completed",
        params: {
          threadId: session.providerSessionId,
          turn: { id: "codex-turn-13", status: "failed", error: { message: "private" } },
        },
      }),
    ).toMatchObject({
      payload: { failureCode: "provider_capacity_unavailable" },
    });
    structuredNotification.normalize({
      method: "turn/started",
      params: { threadId: session.providerSessionId, turn: { id: "codex-turn-14" } },
    });
    expect(
      structuredNotification.normalize({
        method: "turn/completed",
        params: {
          threadId: session.providerSessionId,
          turn: { id: "codex-turn-14", status: "failed", error: { message: "private" } },
        },
      }),
    ).toMatchObject({
      payload: { failureCode: "codex_turn_failed" },
    });
    expect(
      normalizerFor("gpt-5.6-terra").normalize({
        method: "turn/completed",
        params: {
          threadId: session.providerSessionId,
          turn: {
            id: "codex-turn-12",
            status: "failed",
            error: { codexErrorInfo: { type: "HttpConnectionFailed", httpStatusCode: 429 } },
          },
        },
      }),
    ).toMatchObject({
      type: "provider.turn.failed",
      payload: { failureCode: "codex_turn_failed" },
    });
  });
});
