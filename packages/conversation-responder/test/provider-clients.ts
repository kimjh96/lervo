import type { ClaudeAgentClient, ClaudeToolUseHandler } from "@lervo/adapter-claude";
import type { CodexAppServerClient, CodexThreadStartOptions } from "@lervo/adapter-codex";

const waiters = new WeakMap<unknown[], () => void>();

function append(queue: unknown[], ...items: unknown[]): void {
  queue.push(...items);
  waiters.get(queue)?.();
}

async function* drain(queue: unknown[], signal: AbortSignal): AsyncIterable<unknown> {
  let index = 0;
  while (!signal.aborted) {
    if (index < queue.length) {
      yield structuredClone(queue[index++]);
      continue;
    }
    await new Promise<void>((resolve) => {
      const wake = () => resolve();
      waiters.set(queue, wake);
      signal.addEventListener("abort", wake, { once: true });
    });
    waiters.delete(queue);
  }
}

export class ConversationCodexClient implements CodexAppServerClient {
  readonly injectedItems: unknown[][] = [];
  readonly notificationsList: unknown[];
  startOptions?: CodexThreadStartOptions;
  instructions = "";
  closed = false;

  constructor(
    readonly threadId: string,
    private readonly turnId: string,
    private readonly result: string,
  ) {
    this.notificationsList = [{ method: "thread/started", params: { thread: { id: threadId } } }];
  }

  async startThread(options: CodexThreadStartOptions) {
    this.startOptions = structuredClone(options);
    return { threadId: this.threadId, model: "codex-conversation-observed" };
  }

  async injectItems(_threadId: string, items: readonly unknown[]) {
    this.injectedItems.push(structuredClone([...items]));
  }

  async startTurn(threadId: string, input: unknown) {
    this.instructions = JSON.stringify(input);
    append(
      this.notificationsList,
      { method: "turn/started", params: { threadId, turn: { id: this.turnId } } },
      {
        method: "item/completed",
        params: {
          threadId,
          turnId: this.turnId,
          item: { type: "agentMessage", id: `${this.turnId}-message`, text: this.result },
        },
      },
      {
        method: "turn/completed",
        params: { threadId, turn: { id: this.turnId, status: "completed", durationMs: 1 } },
      },
    );
    return { turnId: this.turnId };
  }

  async respondFileChangeApproval() {}
  async interruptTurn() {}
  async unsubscribe() {}
  notifications(signal: AbortSignal) {
    return drain(this.notificationsList, signal);
  }
  async close() {
    this.closed = true;
  }
}

export class ConversationClaudeClient implements ClaudeAgentClient {
  readonly appendedContexts: string[] = [];
  readonly messageList: unknown[] = [];
  instructions = "";
  closed = false;

  constructor(
    readonly providerSessionId: string,
    private readonly resultMessageId: string,
    private readonly result: string,
  ) {}

  attachToolUseHandler(_handler: ClaudeToolUseHandler) {}

  async appendContext(content: string) {
    this.appendedContexts.push(content);
    append(this.messageList, {
      type: "system",
      subtype: "init",
      session_id: this.providerSessionId,
      uuid: "33333333-3333-4333-8333-333333333333",
    });
  }

  async startTurn(turnId: string, instructions: string) {
    this.instructions = instructions;
    append(
      this.messageList,
      {
        type: "user",
        isReplay: true,
        shouldQuery: true,
        uuid: turnId,
        session_id: this.providerSessionId,
        message: { role: "user", content: instructions },
        parent_tool_use_id: null,
      },
      {
        type: "assistant",
        uuid: `${turnId}-assistant`,
        session_id: this.providerSessionId,
        parent_tool_use_id: null,
        message: { model: "claude-conversation-observed", content: [] },
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        user_message_uuid: turnId,
        uuid: this.resultMessageId,
        session_id: this.providerSessionId,
        duration_ms: 1,
        result: this.result,
        modelUsage: {
          "claude-conversation-observed": {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextWindow: 1000,
          },
        },
      },
    );
  }

  async interrupt() {}
  messages(signal: AbortSignal) {
    return drain(this.messageList, signal);
  }
  async close() {
    this.closed = true;
  }
}
