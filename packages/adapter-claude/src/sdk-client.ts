import {
  startup as defaultStartup,
  type Query,
  type WarmQuery,
} from "@anthropic-ai/claude-agent-sdk";

import { AsyncQueue } from "./async-queue.js";
import { createClaudeManagedWriteHooks } from "./sdk-managed-write-hooks.js";
import { ClaudeInputStream, ClaudeReplayTracker } from "./sdk-stream.js";
import {
  ClaudeAdapterError,
  type ClaudeAgentClient,
  type ClaudeAgentClientStartOptions,
  type ClaudeToolUseHandler,
} from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ClaudeSdkAgentClient implements ClaudeAgentClient {
  private readonly input = new ClaudeInputStream();
  private readonly output = new AsyncQueue<unknown>();
  private readonly replays: ClaudeReplayTracker;
  private readonly abortController: AbortController;
  private query: Query | undefined;
  private pump: Promise<void> | undefined;
  private closed = false;
  private toolUseHandler: ClaudeToolUseHandler | undefined;

  private constructor(
    private readonly options: ClaudeAgentClientStartOptions,
    private readonly warm: WarmQuery,
    abortController: AbortController,
  ) {
    this.abortController = abortController;
    this.replays = new ClaudeReplayTracker(options.providerSessionId, options.requestTimeoutMs);
  }

  static async connect(
    options: ClaudeAgentClientStartOptions,
    sdkStartup: typeof defaultStartup = defaultStartup,
  ): Promise<ClaudeSdkAgentClient> {
    const abortController = new AbortController();
    let warm: WarmQuery;
    let connected: ClaudeSdkAgentClient | undefined;
    try {
      warm = await sdkStartup({
        initializeTimeoutMs: options.requestTimeoutMs,
        options: {
          abortController,
          cwd: options.cwd,
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.executable === undefined
            ? {}
            : { pathToClaudeCodeExecutable: options.executable }),
          sessionId: options.providerSessionId,
          permissionMode: options.permissionMode,
          settingSources: [],
          skills: [],
          strictMcpConfig: true,
          mcpServers: {},
          disallowedTools: ["Agent", "Task"],
          tools: options.tools ?? { type: "preset", preset: "claude_code" },
          includePartialMessages: false,
          hooks: createClaudeManagedWriteHooks({
            handler: () => connected?.toolUseHandler,
            fail: (error) => {
              if (connected === undefined) {
                throw error;
              }
              return connected.failManagedWrite(error);
            },
          }),
          canUseTool: async () => ({
            behavior: "deny" as const,
            message: "Roven approval bridge가 연결되지 않아 이 권한 요청을 거부했습니다.",
          }),
        },
      });
    } catch {
      throw new ClaudeAdapterError("provider_process_failed", "Claude Agent SDK를 시작하지 못했습니다.");
    }
    connected = new ClaudeSdkAgentClient(options, warm, abortController);
    return connected;
  }

  attachToolUseHandler(handler: ClaudeToolUseHandler): void {
    if (this.toolUseHandler !== undefined) {
      throw new ClaudeAdapterError("invalid_request", "Claude tool handler가 이미 연결되었습니다.");
    }
    this.toolUseHandler = handler;
  }

  private failManagedWrite(error: unknown): never {
    const failure =
      error instanceof Error
        ? error
        : new ClaudeAdapterError(
            "provider_protocol_failed",
            "Claude managed write bridge가 실패했습니다.",
          );
    this.output.fail(failure);
    throw failure;
  }

  async appendContext(content: string): Promise<void> {
    await this.send(content, false);
  }

  async startTurn(turnId: string, instructions: string): Promise<void> {
    await this.send(instructions, true, turnId);
  }

  async interrupt(): Promise<void> {
    if (this.query === undefined) return;
    try {
      await this.query.interrupt();
    } catch {
      throw new ClaudeAdapterError("provider_process_failed", "Claude turn을 중단하지 못했습니다.");
    }
  }

  messages(signal: AbortSignal): AsyncIterable<unknown> {
    return this.output.iterate(signal);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.input.end();
    try {
      if (this.query === undefined) {
        this.warm.close();
      } else {
        await this.finishQueryWithinDeadline();
      }
    } catch {
      this.abortController.abort();
      throw new ClaudeAdapterError("provider_process_failed", "Claude Agent SDK를 종료하지 못했습니다.");
    } finally {
      this.abortController.abort();
      this.output.end();
      this.replays.fail(
        new ClaudeAdapterError("session_stopped", "Claude session이 입력 확인 전에 종료되었습니다."),
      );
    }
  }

  private async finishQueryWithinDeadline(): Promise<void> {
    const operation = (async () => {
      await this.query!.return(undefined);
      await this.pump;
    })();
    void operation.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Claude shutdown deadline exceeded")),
            this.options.requestTimeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async send(content: string, shouldQuery: boolean, messageId?: string): Promise<void> {
    if (this.closed) throw new ClaudeAdapterError("session_stopped", "이미 종료된 Claude session입니다.");
    const uuid = messageId ?? this.options.createMessageId();
    if (!UUID_PATTERN.test(uuid)) {
      throw new ClaudeAdapterError("invalid_request", "Claude input message ID는 UUID여야 합니다.");
    }
    const accepted = this.replays.expect(uuid, content);
    this.ensureStream();
    this.input.push({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: content }],
      },
      parent_tool_use_id: null,
      isSynthetic: !shouldQuery,
      shouldQuery,
      uuid: uuid as `${string}-${string}-${string}-${string}-${string}`,
      session_id: this.options.providerSessionId,
    });
    await accepted;
  }

  private ensureStream(): void {
    if (this.query !== undefined) return;
    this.query = this.warm.query(this.input);
    this.pump = this.pumpMessages(this.query);
  }

  private async pumpMessages(query: Query): Promise<void> {
    try {
      for await (const message of query) {
        this.replays.accept(message);
        this.output.push(message);
      }
      if (!this.closed) {
        throw new ClaudeAdapterError("provider_process_failed", "Claude event stream이 예기치 않게 끝났습니다.");
      }
    } catch (error) {
      const failure =
        error instanceof ClaudeAdapterError
          ? error
          : new ClaudeAdapterError("provider_process_failed", "Claude event stream을 읽지 못했습니다.");
      this.replays.fail(failure);
      this.output.fail(failure);
    }
  }
}
