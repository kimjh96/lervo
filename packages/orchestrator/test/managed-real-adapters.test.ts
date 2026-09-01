import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ClaudeAdapter,
  type ClaudeAgentClient,
  type ClaudeAgentClientStartOptions,
  type ClaudeToolUseHandler,
} from "@lervo/adapter-claude";
import {
  CodexAdapter,
  type CodexAppServerClient,
  type CodexThreadStartOptions,
} from "@lervo/adapter-codex";
import { afterEach, describe, expect, it } from "vitest";

import { ManagedProviderRunCoordinator } from "../src/index.js";
import {
  cleanupManagedFixtures,
  createManagedFixture,
  MemoryArtifactStore,
  policyVersion,
  projectId,
  providerRunInput,
  role,
  runId,
  sequenceFactory,
  sessionId,
} from "./fixture.js";

const CLAUDE_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CLAUDE_TURN_ID = "22222222-2222-4222-8222-222222222222";

function clock(): () => Date {
  let value = Date.parse("2026-08-18T01:00:00Z");
  return () => {
    const current = new Date(value);
    value += 1_000;
    return current;
  };
}

const queueWaiters = new WeakMap<unknown[], () => void>();

function appendQueue(queue: unknown[], ...items: unknown[]): void {
  queue.push(...items);
  queueWaiters.get(queue)?.();
}

async function* drainQueue(queue: unknown[], signal: AbortSignal): AsyncIterable<unknown> {
  let index = 0;
  while (!signal.aborted) {
    if (index < queue.length) {
      yield structuredClone(queue[index++]);
      continue;
    }
    await new Promise<void>((resolve) => {
      const wake = () => resolve();
      queueWaiters.set(queue, wake);
      signal.addEventListener("abort", wake, { once: true });
    });
    queueWaiters.delete(queue);
  }
}

class AcceptanceCodexClient implements CodexAppServerClient {
  readonly notificationsList: unknown[] = [
    { method: "thread/started", params: { thread: { id: "codex-thread-acceptance" } } },
  ];
  startOptions?: CodexThreadStartOptions;

  constructor(private readonly managedRoot?: string) {}

  async startThread(options: CodexThreadStartOptions) {
    this.startOptions = structuredClone(options);
    return { threadId: "codex-thread-acceptance" };
  }

  async injectItems() {}

  async startTurn(threadId: string) {
    if (this.managedRoot !== undefined) {
      appendQueue(
        this.notificationsList,
        { method: "turn/started", params: { threadId, turn: { id: "codex-turn-acceptance" } } },
        {
          method: "item/started",
          params: {
            threadId,
            turnId: "codex-turn-acceptance",
            item: {
              type: "fileChange",
              id: "codex-managed-change",
              status: "inProgress",
              changes: [
                {
                  path: resolve(this.managedRoot, "src/result.ts"),
                  kind: { type: "add" },
                  diff: "private patch",
                },
              ],
            },
          },
        },
        {
          id: "codex-managed-approval",
          method: "item/fileChange/requestApproval",
          params: {
            threadId,
            turnId: "codex-turn-acceptance",
            itemId: "codex-managed-change",
            startedAtMs: Date.parse("2026-08-18T01:00:08Z"),
          },
        },
      );
      return { turnId: "codex-turn-acceptance" };
    }
    appendQueue(
      this.notificationsList,
      { method: "turn/started", params: { threadId, turn: { id: "codex-turn-acceptance" } } },
      {
        method: "item/completed",
        params: {
          threadId,
          turnId: "codex-turn-acceptance",
          item: { type: "agentMessage", id: "message-acceptance", text: "Complete" },
        },
      },
      {
        method: "thread/tokenUsage/updated",
        params: {
          threadId,
          turnId: "codex-turn-acceptance",
          tokenUsage: {
            total: {
              inputTokens: 8,
              cachedInputTokens: 2,
              outputTokens: 3,
              reasoningOutputTokens: 1,
              totalTokens: 11,
            },
            modelContextWindow: 128_000,
          },
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId,
          turn: { id: "codex-turn-acceptance", status: "completed", durationMs: 1 },
        },
      },
    );
    return { turnId: "codex-turn-acceptance" };
  }

  async interruptTurn() {}
  async respondFileChangeApproval(_requestId: string | number, decision: "accept" | "decline") {
    if (this.managedRoot === undefined || decision !== "accept") return;
    await writeFile(resolve(this.managedRoot, "src/result.ts"), "export const managed = true;\n");
    appendQueue(
      this.notificationsList,
      {
        method: "item/completed",
        params: {
          threadId: "codex-thread-acceptance",
          turnId: "codex-turn-acceptance",
          item: {
            type: "fileChange",
            id: "codex-managed-change",
            status: "completed",
            changes: [
              {
                path: resolve(this.managedRoot, "src/result.ts"),
                kind: { type: "add" },
                diff: "private patch",
              },
            ],
          },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId: "codex-thread-acceptance",
          turnId: "codex-turn-acceptance",
          item: { type: "agentMessage", id: "message-acceptance", text: "Complete" },
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId: "codex-thread-acceptance",
          turn: { id: "codex-turn-acceptance", status: "completed", durationMs: 1 },
        },
      },
    );
  }
  async unsubscribe() {}
  notifications(signal: AbortSignal) {
    return drainQueue(this.notificationsList, signal);
  }
  async close() {}
}

class AcceptanceClaudeClient implements ClaudeAgentClient {
  readonly messageList: unknown[] = [];
  private toolUseHandler?: ClaudeToolUseHandler;

  constructor(private readonly managedRoot?: string) {}

  attachToolUseHandler(handler: ClaudeToolUseHandler) {
    this.toolUseHandler = handler;
  }

  async appendContext() {
    appendQueue(this.messageList, {
      type: "system",
      subtype: "init",
      session_id: CLAUDE_SESSION_ID,
      uuid: "33333333-3333-4333-8333-333333333333",
    });
  }

  async startTurn(turnId: string, instructions: string) {
    const emitResult = () =>
      appendQueue(
        this.messageList,
        {
          type: "user",
          isReplay: true,
          shouldQuery: true,
          uuid: turnId,
          session_id: CLAUDE_SESSION_ID,
          message: { role: "user", content: instructions },
          parent_tool_use_id: null,
        },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          user_message_uuid: turnId,
          uuid: "44444444-4444-4444-8444-444444444444",
          session_id: CLAUDE_SESSION_ID,
          duration_ms: 1,
          result: "Complete",
          modelUsage: {
            "claude-test": {
              inputTokens: 8,
              outputTokens: 3,
              cacheReadInputTokens: 2,
              cacheCreationInputTokens: 1,
              contextWindow: 128_000,
            },
          },
        },
      );
    if (this.managedRoot !== undefined) {
      const input = {
        file_path: resolve(this.managedRoot, "src/result.ts"),
        content: "export const managed = true;\n",
      };
      const allowed = await this.toolUseHandler?.authorize("Write", input, "claude-managed-write");
      if (allowed !== true) throw new Error("managed write denied");
      await writeFile(input.file_path, input.content);
      await this.toolUseHandler?.complete("Write", input, "claude-managed-write", "completed");
      emitResult();
      return;
    }
    emitResult();
  }

  async interrupt() {}
  messages(signal: AbortSignal) {
    return drainQueue(this.messageList, signal);
  }
  async close() {}
}

afterEach(cleanupManagedFixtures);

describe("managed coordinator with production adapters", () => {
  it("runs Codex with the enforced read-only sandbox", async () => {
    const data = await createManagedFixture();
    const client = new AcceptanceCodexClient();
    const artifactStore = new MemoryArtifactStore();
    const now = clock();
    const adapter = new CodexAdapter({
      repositoryRoot: data.root,
      clientFactory: async () => client,
      now,
      createEventId: sequenceFactory("evt_codex_acceptance"),
      createReceiptId: sequenceFactory("ctx_codex_acceptance"),
    });
    const result = await new ManagedProviderRunCoordinator({
      adapter,
      coordinates: { projectId, runId, sessionId, roleId: role.roleId },
      policyVersion,
      events: data.store,
      artifactStore,
      now,
      createEventId: sequenceFactory("evt_run_acceptance"),
    }).run({ ...providerRunInput(), repositoryRoot: data.root });

    expect(result.status).toBe("completed");
    expect(result.session.executionMode).toBe("read_only");
    expect(Buffer.from(await artifactStore.get(result.resultArtifact.uri)).toString("utf8")).toBe(
      "Complete",
    );
    expect(JSON.stringify(data.store.list({ runId }))).not.toContain("Complete");
    expect(client.startOptions).toMatchObject({ sandbox: "read-only", approvalPolicy: "never" });
    expect(
      data.store.list({ runId }).find((event) => event.type === "adapter.started")?.payload,
    ).toMatchObject({ executionMode: "read_only" });
    expect(
      data.store.list({ runId }).find((event) => event.type === "resource.usage.recorded")?.payload,
    ).toMatchObject({ status: "observed", usage: { totalTokens: 11 } });
    data.store.close();
  });

  it("runs Claude with plan mode and read-only tools", async () => {
    const data = await createManagedFixture();
    const client = new AcceptanceClaudeClient();
    const artifactStore = new MemoryArtifactStore();
    let startOptions: ClaudeAgentClientStartOptions | undefined;
    const now = clock();
    const adapter = new ClaudeAdapter({
      repositoryRoot: data.root,
      clientFactory: async (options) => {
        startOptions = {
          ...options,
          ...(options.tools === undefined ? {} : { tools: [...options.tools] }),
        };
        return client;
      },
      now,
      createProviderSessionId: () => CLAUDE_SESSION_ID,
      createProviderMessageId: () => CLAUDE_TURN_ID,
      createEventId: sequenceFactory("evt_claude_acceptance"),
      createReceiptId: sequenceFactory("ctx_claude_acceptance"),
    });
    const result = await new ManagedProviderRunCoordinator({
      adapter,
      coordinates: { projectId, runId, sessionId, roleId: role.roleId },
      policyVersion,
      events: data.store,
      artifactStore,
      now,
      createEventId: sequenceFactory("evt_run_acceptance"),
    }).run({ ...providerRunInput(), repositoryRoot: data.root });

    expect(result.status).toBe("completed");
    expect(Buffer.from(await artifactStore.get(result.resultArtifact.uri)).toString("utf8")).toBe(
      "Complete",
    );
    expect(JSON.stringify(data.store.list({ runId }))).not.toContain("Complete");
    expect(startOptions).toMatchObject({
      permissionMode: "plan",
      tools: ["Read", "Glob", "Grep"],
    });
    expect(
      data.store.list({ runId }).find((event) => event.type === "resource.usage.recorded")?.payload,
    ).toMatchObject({ status: "observed", usage: { totalTokens: 14 } });
    expect(
      data.store.list({ runId }).find((event) => event.type === "adapter.started")?.payload,
    ).toMatchObject({ executionMode: "read_only" });
    data.store.close();
  });

  it("applies a Codex file-change approval through the managed permit", async () => {
    const data = await createManagedFixture();
    const client = new AcceptanceCodexClient(data.root);
    const input = providerRunInput();
    const now = clock();
    const result = await new ManagedProviderRunCoordinator({
      adapter: new CodexAdapter({
        repositoryRoot: data.root,
        clientFactory: async () => client,
        now,
        createEventId: sequenceFactory("evt_codex_write"),
        createReceiptId: sequenceFactory("ctx_codex_write"),
      }),
      coordinates: { projectId, runId, sessionId, roleId: role.roleId },
      policyVersion,
      events: data.store,
      artifactStore: new MemoryArtifactStore(),
      now,
      createEventId: sequenceFactory("evt_run_write"),
    }).run({
      ...input,
      repositoryRoot: data.root,
      context: { ...input.context, role },
    });

    expect(result.session.executionMode).toBe("managed_write");
    expect(result.managedChanges).toEqual([
      expect.objectContaining({ path: "src/result.ts", changeKind: "created" }),
    ]);
    expect(client.startOptions).toMatchObject({
      sandbox: "read-only",
      approvalPolicy: "on-request",
    });
    expect(data.store.list({ runId }).map((event) => event.type)).not.toContain(
      "unmanaged_change.detected",
    );
    data.store.close();
  });

  it("applies a Claude Write hook through the same managed permit", async () => {
    const data = await createManagedFixture();
    const client = new AcceptanceClaudeClient(data.root);
    const input = providerRunInput();
    let startOptions: ClaudeAgentClientStartOptions | undefined;
    const now = clock();
    const result = await new ManagedProviderRunCoordinator({
      adapter: new ClaudeAdapter({
        repositoryRoot: data.root,
        clientFactory: async (options) => {
          startOptions = options;
          return client;
        },
        now,
        createProviderSessionId: () => CLAUDE_SESSION_ID,
        createProviderMessageId: () => CLAUDE_TURN_ID,
        createEventId: sequenceFactory("evt_claude_write"),
        createReceiptId: sequenceFactory("ctx_claude_write"),
      }),
      coordinates: { projectId, runId, sessionId, roleId: role.roleId },
      policyVersion,
      events: data.store,
      artifactStore: new MemoryArtifactStore(),
      now,
      createEventId: sequenceFactory("evt_run_write"),
    }).run({
      ...input,
      repositoryRoot: data.root,
      context: { ...input.context, role },
    });

    expect(result.session.executionMode).toBe("managed_write");
    expect(result.managedChanges).toEqual([
      expect.objectContaining({ path: "src/result.ts", changeKind: "created" }),
    ]);
    expect(startOptions).toMatchObject({
      permissionMode: "default",
      tools: ["Read", "Glob", "Grep", "Write", "Edit"],
    });
    expect(data.store.list({ runId }).map((event) => event.type)).not.toContain(
      "unmanaged_change.detected",
    );
    data.store.close();
  });
});
