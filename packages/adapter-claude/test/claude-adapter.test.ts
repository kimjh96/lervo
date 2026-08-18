import { createHash } from "node:crypto";

import {
  createManagedWriteDecision,
  evaluateAdapterContract,
  evaluateManagedWriteContract,
  type ProviderManagedWriteBridge,
} from "@roven/adapter-contract";
import type {
  AdapterContextEnvelope,
  AdapterManagedWriteCompletion,
  AdapterManagedWriteRequest,
  AdapterSession,
  AdapterStartRequest,
  AdapterTurnRequest,
} from "@roven/schemas";
import { describe, expect, it } from "vitest";

import {
  ClaudeAdapter,
  ClaudeAdapterError,
  type ClaudeAgentClient,
  type ClaudeToolUseHandler,
} from "../src/index.js";

const PROVIDER_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PROVIDER_TURN_ID = "22222222-2222-4222-8222-222222222222";

function sha(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

class FakeClaudeClient implements ClaudeAgentClient {
  readonly calls: Array<{ method: string; value: unknown }> = [];
  readonly messageList: unknown[] = [];
  closed = false;
  failClose = false;
  toolUseHandler?: ClaudeToolUseHandler;

  attachToolUseHandler(handler: ClaudeToolUseHandler) {
    this.toolUseHandler = handler;
  }

  async appendContext(content: string) {
    this.calls.push({ method: "appendContext", value: content });
    this.messageList.push({
      type: "system",
      subtype: "init",
      session_id: PROVIDER_SESSION_ID,
      uuid: "33333333-3333-4333-8333-333333333333",
    });
  }

  async startTurn(turnId: string, instructions: string) {
    this.calls.push({ method: "startTurn", value: { turnId, instructions } });
    this.messageList.push(
      {
        type: "user",
        isReplay: true,
        shouldQuery: true,
        uuid: turnId,
        session_id: PROVIDER_SESSION_ID,
        timestamp: "2026-08-18T00:00:03Z",
        message: { role: "user", content: instructions },
        parent_tool_use_id: null,
      },
      {
        type: "assistant",
        uuid: "44444444-4444-4444-8444-444444444444",
        session_id: PROVIDER_SESSION_ID,
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-bash-1",
              name: "Bash",
              input: { command: "printf super-secret-command", cwd: "/repo" },
            },
          ],
        },
      },
      {
        type: "user",
        uuid: "55555555-5555-4555-8555-555555555555",
        session_id: PROVIDER_SESSION_ID,
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-bash-1",
              content: "super-secret-output",
              is_error: false,
            },
          ],
        },
        tool_use_result: { exitCode: 0, durationMs: 9 },
      },
      {
        type: "assistant",
        uuid: "66666666-6666-4666-8666-666666666666",
        session_id: PROVIDER_SESSION_ID,
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-read-1",
              name: "Read",
              input: { file_path: "/repo/super-secret-file.ts" },
            },
          ],
        },
      },
      {
        type: "user",
        uuid: "77777777-7777-4777-8777-777777777777",
        session_id: PROVIDER_SESSION_ID,
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-read-1",
              content: "super-secret-file-content",
              is_error: false,
            },
          ],
        },
      },
      {
        type: "system",
        subtype: "compact_boundary",
        uuid: "88888888-8888-4888-8888-888888888888",
        session_id: PROVIDER_SESSION_ID,
        compact_metadata: { trigger: "auto", pre_tokens: 1_000, post_tokens: 300 },
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        user_message_uuid: turnId,
        uuid: "99999999-9999-4999-8999-999999999999",
        session_id: PROVIDER_SESSION_ID,
        duration_ms: 20,
        result: "super-secret-result",
        modelUsage: { "claude-test": { inputTokens: 10, outputTokens: 2 } },
      },
    );
  }

  async interrupt() {
    this.calls.push({ method: "interrupt", value: null });
  }

  async *messages(signal: AbortSignal): AsyncIterable<unknown> {
    let index = 0;
    while (!signal.aborted) {
      if (index < this.messageList.length) {
        yield structuredClone(this.messageList[index]);
        index += 1;
        continue;
      }
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    }
  }

  async close() {
    this.closed = true;
    this.calls.push({ method: "close", value: null });
    if (this.failClose) throw new Error("close failed");
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
  client: FakeClaudeClient,
  overrides: Partial<ConstructorParameters<typeof ClaudeAdapter>[0]> = {},
) {
  let eventSequence = 0;
  return new ClaudeAdapter({
    repositoryRoot: "/repo",
    clientFactory: async () => client,
    now: clock(),
    createProviderSessionId: () => PROVIDER_SESSION_ID,
    createProviderMessageId: () => PROVIDER_TURN_ID,
    createReceiptId: () => "ctx_claude001",
    createEventId: () => `evt_claude${String(++eventSequence).padStart(3, "0")}`,
    ...overrides,
  });
}

function fixture() {
  const agents = "모든 전문 에이전트는 같은 검증된 맥락을 받습니다.\n";
  const writing = "한국 사람이 평소에 이해하는 문장과 이어지는 문단으로 씁니다.\n";
  const startRequest: AdapterStartRequest = {
    kind: "start_request",
    schemaVersion: 1,
    adapterId: "roven/claude",
    projectId: "prj_01234567",
    runId: "run_01234567",
    sessionId: "ses_01234567",
    roleId: "developer",
    writingPolicyId: "writing_ko-kr-human",
    requestDigest: sha("fixture request"),
    executionMode: "read_only",
    requestedAt: "2026-08-18T00:00:00Z",
  };
  const contextEnvelope: AdapterContextEnvelope = {
    kind: "context_envelope",
    schemaVersion: 1,
    envelopeId: "envelope-claude-1",
    adapterId: "roven/claude",
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
        delivery: { kind: "inline", content: agents },
      },
      {
        documentId: "doc_writing_policy",
        path: ".roven/writing.ko-KR.md",
        contentHash: sha(writing),
        byteCount: Buffer.byteLength(writing),
        scope: { kind: "full" },
        delivery: { kind: "inline", content: writing },
      },
    ],
    createdAt: "2026-08-18T00:00:01Z",
  };
  const turnRequest: AdapterTurnRequest = {
    kind: "turn_request",
    schemaVersion: 1,
    adapterId: "roven/claude",
    projectId: startRequest.projectId,
    runId: startRequest.runId,
    sessionId: startRequest.sessionId,
    providerSessionId: PROVIDER_SESSION_ID,
    targetTurnId: contextEnvelope.targetTurnId,
    instructions: "작은 기능을 구현합니다.",
    requestedAt: "2026-08-18T00:00:02Z",
  };
  return { startRequest, contextEnvelope, turnRequest, agents, writing };
}

async function start(instance: ClaudeAdapter): Promise<AdapterSession> {
  return instance.start(fixture().startRequest);
}

describe("Claude managed adapter", () => {
  it("rejects a non-plan permission mode before starting Claude", async () => {
    const client = new FakeClaudeClient();
    await expect(
      adapter(client, { permissionMode: "dontAsk" }).start(fixture().startRequest),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(client.calls).toEqual([]);
  });

  it("rejects tools outside the managed read-only set", async () => {
    const client = new FakeClaudeClient();
    await expect(
      adapter(client, { tools: ["Read", "Bash"] }).start(fixture().startRequest),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(client.calls).toEqual([]);
  });

  it("passes the common contract with the same role, writing policy and document hashes", async () => {
    const client = new FakeClaudeClient();
    const report = await evaluateAdapterContract(adapter(client), {
      expectedProvider: "claude",
      ...fixture(),
      stopReason: "completed",
      expectedEventCount: 6,
      expectedResultContent: "super-secret-result",
    });
    expect(report).toEqual({ passed: true, violations: [] });
    expect(client.closed).toBe(true);
  });

  it("reports only the capabilities effective for the selected session mode", async () => {
    const readOnly = await start(adapter(new FakeClaudeClient()));
    const managed = await adapter(new FakeClaudeClient()).start({
      ...fixture().startRequest,
      executionMode: "managed_write",
    });

    expect(readOnly.effectiveCapabilities).toMatchObject({
      commandExecution: "unsupported",
      fileChanges: "unsupported",
    });
    expect(managed.effectiveCapabilities).toMatchObject({
      commandExecution: "unsupported",
      fileChanges: "supported",
    });
  });

  it("routes Write through the managed bridge without exposing tool content", async () => {
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
    const client = new FakeClaudeClient();
    const instance = adapter(client);
    const data = fixture();
    const bridge = new RecordingBridge();
    const session = await instance.start({ ...data.startRequest, executionMode: "managed_write" });
    await instance.injectContext(session, data.contextEnvelope);
    await instance.attachManagedWriteBridge(session, bridge);
    const turn = await instance.startTurn(session, data.turnRequest, () => undefined);
    const allowed = await client.toolUseHandler?.authorize(
      "Write",
      { file_path: "/repo/src/new.ts", content: "super-secret-file-content" },
      "tool-write-1",
    );
    await client.toolUseHandler?.complete(
      "Write",
      { file_path: "/repo/src/new.ts", content: "super-secret-file-content" },
      "tool-write-1",
      "completed",
    );

    expect(allowed).toBe(true);
    expect(bridge.requests).toEqual([
      expect.objectContaining({
        providerItemId: "tool-write-1",
        path: "src/new.ts",
        changeKind: "upsert",
      }),
    ]);
    expect(bridge.completions).toEqual([
      expect.objectContaining({ providerItemId: "tool-write-1", status: "completed" }),
    ]);
    expect(JSON.stringify(bridge.requests)).not.toContain("super-secret-file-content");
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

  it("appends all managed documents without a model query before starting the turn", async () => {
    const client = new FakeClaudeClient();
    const instance = adapter(client);
    const data = fixture();
    const session = await instance.start(data.startRequest);
    const receipt = await instance.injectContext(session, data.contextEnvelope);
    await instance.startTurn(session, data.turnRequest, () => undefined);

    const context = String(client.calls[0]?.value);
    expect(context).toContain(data.agents.trim());
    expect(context).toContain(data.writing.trim());
    expect(context).toContain(data.startRequest.roleId);
    expect(context).toContain(data.startRequest.writingPolicyId as string);
    expect(receipt.documents.map((item) => item.contentHash)).toEqual(
      data.contextEnvelope.documents.map((item) => item.contentHash),
    );
    expect(client.calls.map((call) => call.method)).toEqual(["appendContext", "startTurn"]);
  });

  it("does not start a turn without the matching controlled context", async () => {
    const client = new FakeClaudeClient();
    const instance = adapter(client);
    const session = await start(instance);
    await expect(
      instance.startTurn(session, fixture().turnRequest, () => undefined),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(client.calls).toEqual([]);
  });

  it("rejects changed context bytes before sending them to Claude", async () => {
    const client = new FakeClaudeClient();
    const instance = adapter(client);
    const session = await start(instance);
    const envelope = fixture().contextEnvelope;
    envelope.documents[0]!.delivery = { kind: "inline", content: "바뀐 원문" };
    await expect(instance.injectContext(session, envelope)).rejects.toBeInstanceOf(ClaudeAdapterError);
    expect(client.calls).toEqual([]);
  });

  it("rejects CAS bytes that cannot be decoded as lossless UTF-8", async () => {
    const client = new FakeClaudeClient();
    const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
    const instance = adapter(client, { resolveArtifact: async () => invalidUtf8 });
    const session = await start(instance);
    const envelope = fixture().contextEnvelope;
    const contentHash = sha(invalidUtf8);
    envelope.documents[0] = {
      ...envelope.documents[0]!,
      contentHash,
      byteCount: invalidUtf8.byteLength,
      delivery: { kind: "cas", uri: `roven-cas://sha256/${contentHash.slice(7)}` },
    };
    await expect(instance.injectContext(session, envelope)).rejects.toMatchObject({
      code: "context_materialization_failed",
    });
    expect(client.calls).toEqual([]);
  });

  it("normalizes only observable telemetry and retains no prompt, command, output or tool input", async () => {
    const client = new FakeClaudeClient();
    const instance = adapter(client);
    const data = fixture();
    const session = await instance.start(data.startRequest);
    await instance.injectContext(session, data.contextEnvelope);
    await instance.startTurn(session, data.turnRequest, () => undefined);
    const controller = new AbortController();
    const iterator = instance.events(session, controller.signal)[Symbol.asyncIterator]();
    const events = [];
    for (let index = 0; index < 6; index += 1) {
      const next = await iterator.next();
      expect(next.done).toBe(false);
      events.push(next.value!);
    }
    controller.abort();
    await iterator.return?.();

    expect(events.map((event) => event.type)).toEqual([
      "provider.session.started",
      "provider.turn.started",
      "provider.command.executed",
      "provider.tool.called",
      "provider.context.compacted",
      "provider.turn.completed",
    ]);
    const serialized = JSON.stringify(events);
    for (const secret of [
      "super-secret-command",
      "super-secret-output",
      "super-secret-file.ts",
      "super-secret-file-content",
      "super-secret-result",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(events.some((event) => event.type === "provider.usage.updated")).toBe(false);
    expect(events.some((event) => event.type === "provider.file_change.reported")).toBe(false);
    expect(instance.descriptor.capabilities).toMatchObject({
      contextCompaction: "supported",
      fileChanges: "supported",
      usage: "unknown",
    });
  });

  it("interrupts an active turn before closing a cancelled session", async () => {
    const client = new FakeClaudeClient();
    const instance = adapter(client);
    const data = fixture();
    const session = await instance.start(data.startRequest);
    await instance.injectContext(session, data.contextEnvelope);
    await instance.startTurn(session, data.turnRequest, () => undefined);
    await instance.stop(session, {
      kind: "stop_request",
      schemaVersion: 1,
      adapterId: "roven/claude",
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      reason: "cancelled",
      requestedAt: "2026-08-18T00:00:04Z",
    });
    expect(client.calls.slice(-2).map((call) => call.method)).toEqual(["interrupt", "close"]);
    await expect(instance.injectContext(session, data.contextEnvelope)).rejects.toMatchObject({
      code: "session_not_found",
    });
  });

  it("releases session state even when the provider close operation fails", async () => {
    const client = new FakeClaudeClient();
    client.failClose = true;
    const instance = adapter(client);
    const data = fixture();
    const session = await instance.start(data.startRequest);
    const stop = instance.stop(session, {
      kind: "stop_request",
      schemaVersion: 1,
      adapterId: "roven/claude",
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
});
