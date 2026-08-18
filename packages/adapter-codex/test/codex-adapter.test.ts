import { createHash } from "node:crypto";

import { evaluateAdapterContract } from "@roven/adapter-contract";
import type {
  AdapterContextEnvelope,
  AdapterSession,
  AdapterStartRequest,
  AdapterTurnRequest,
} from "@roven/schemas";
import { describe, expect, it } from "vitest";

import {
  CodexAdapter,
  CodexAdapterError,
  CodexEventNormalizer,
  type CodexAppServerClient,
  type CodexThreadStartOptions,
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

  async startThread(options: CodexThreadStartOptions) {
    this.calls.push({ method: "startThread", value: options });
    return { threadId: "codex-thread-1" };
  }

  async injectItems(threadId: string, items: readonly unknown[]) {
    this.calls.push({ method: "injectItems", value: { threadId, items: structuredClone(items) } });
  }

  async startTurn(threadId: string, instructions: string) {
    this.calls.push({ method: "startTurn", value: { threadId, instructions } });
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
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    }
  }

  async close() {
    this.closed = true;
    this.calls.push({ method: "close", value: null });
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

function adapter(client: FakeCodexClient, overrides: Partial<ConstructorParameters<typeof CodexAdapter>[0]> = {}) {
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
  const agents = "모든 에이전트가 이 문서를 읽습니다.\n";
  const writing = "사람이 이해하는 한국어 문장으로 씁니다.\n";
  const startRequest: AdapterStartRequest = {
    kind: "start_request",
    schemaVersion: 1,
    adapterId: "roven/codex",
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
    envelopeId: "envelope-codex-1",
    adapterId: "roven/codex",
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
    adapterId: "roven/codex",
    projectId: startRequest.projectId,
    runId: startRequest.runId,
    sessionId: startRequest.sessionId,
    providerSessionId: "codex-thread-1",
    targetTurnId: contextEnvelope.targetTurnId,
    instructions: "작은 기능을 구현합니다.",
    requestedAt: "2026-08-18T00:00:02Z",
  };
  return { startRequest, contextEnvelope, turnRequest, agents, writing };
}

async function started(adapterInstance: CodexAdapter): Promise<AdapterSession> {
  return adapterInstance.start(fixture().startRequest);
}

describe("Codex managed adapter", () => {
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
    const report = await evaluateAdapterContract(adapter(client), {
      expectedProvider: "codex",
      ...fixture(),
      stopReason: "completed",
      expectedEventCount: 7,
      expectedResultContent: "super-secret-result",
    });
    expect(report).toEqual({ passed: true, violations: [] });
    expect(client.closed).toBe(true);
  });

  it("injects exact role, writing policy, hashes and document bytes before the turn", async () => {
    const client = new FakeCodexClient();
    const instance = adapter(client);
    const data = fixture();
    const session = await instance.start(data.startRequest);
    await instance.injectContext(session, data.contextEnvelope);
    await instance.startTurn(session, data.turnRequest);

    const injection = client.calls.find((call) => call.method === "injectItems");
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
    await expect(instance.startTurn(session, fixture().turnRequest)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(client.calls.some((call) => call.method === "startTurn")).toBe(false);
  });

  it("rejects changed inline bytes before claiming injection", async () => {
    const client = new FakeCodexClient();
    const instance = adapter(client);
    const session = await started(instance);
    const envelope = fixture().contextEnvelope;
    envelope.documents[0]!.delivery = { kind: "inline", content: "바뀐 원문" };
    await expect(instance.injectContext(session, envelope)).rejects.toBeInstanceOf(CodexAdapterError);
    expect(client.calls.some((call) => call.method === "injectItems")).toBe(false);
  });

  it("normalizes provider reports without retaining commands, output, diffs or absolute paths", async () => {
    const client = new FakeCodexClient();
    const instance = adapter(client);
    const data = fixture();
    const session = await instance.start(data.startRequest);
    await instance.injectContext(session, data.contextEnvelope);
    await instance.startTurn(session, data.turnRequest);
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
  });

  it("interrupts the active provider turn when a managed session is cancelled", async () => {
    const client = new FakeCodexClient();
    const instance = adapter(client);
    const data = fixture();
    const session = await instance.start(data.startRequest);
    await instance.injectContext(session, data.contextEnvelope);
    await instance.startTurn(session, data.turnRequest);
    await instance.stop(session, {
      kind: "stop_request",
      schemaVersion: 1,
      adapterId: "roven/codex",
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
});
