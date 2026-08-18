import { ClaudeAdapter, type ClaudeAgentClient, type ClaudeAgentClientStartOptions } from "@roven/adapter-claude";
import {
  CodexAdapter,
  type CodexAppServerClient,
  type CodexThreadStartOptions,
} from "@roven/adapter-codex";
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

  async startThread(options: CodexThreadStartOptions) {
    this.startOptions = structuredClone(options);
    return { threadId: "codex-thread-acceptance" };
  }

  async injectItems() {}

  async startTurn(threadId: string) {
    appendQueue(
      this.notificationsList,
      { method: "turn/started", params: { threadId, turn: { id: "codex-turn-acceptance" } } },
      {
        method: "item/completed",
        params: {
          threadId,
          turnId: "codex-turn-acceptance",
          item: { type: "agentMessage", id: "message-acceptance", text: "완료" },
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
  async unsubscribe() {}
  notifications(signal: AbortSignal) {
    return drainQueue(this.notificationsList, signal);
  }
  async close() {}
}

class AcceptanceClaudeClient implements ClaudeAgentClient {
  readonly messageList: unknown[] = [];

  async appendContext() {
    appendQueue(this.messageList, {
      type: "system",
      subtype: "init",
      session_id: CLAUDE_SESSION_ID,
      uuid: "33333333-3333-4333-8333-333333333333",
    });
  }

  async startTurn(turnId: string, instructions: string) {
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
        result: "완료",
      },
    );
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
    expect(Buffer.from(await artifactStore.get(result.resultArtifact.uri)).toString("utf8"))
      .toBe("완료");
    expect(JSON.stringify(data.store.list({ runId }))).not.toContain("완료");
    expect(client.startOptions).toMatchObject({ sandbox: "read-only", approvalPolicy: "never" });
    expect(data.store.list({ runId }).find((event) => event.type === "adapter.started")?.payload)
      .toMatchObject({ executionMode: "read_only" });
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
    expect(Buffer.from(await artifactStore.get(result.resultArtifact.uri)).toString("utf8"))
      .toBe("완료");
    expect(JSON.stringify(data.store.list({ runId }))).not.toContain("완료");
    expect(startOptions).toMatchObject({
      permissionMode: "plan",
      tools: ["Read", "Glob", "Grep"],
    });
    expect(data.store.list({ runId }).find((event) => event.type === "adapter.started")?.payload)
      .toMatchObject({ executionMode: "read_only" });
    data.store.close();
  });
});
