import { randomUUID } from "node:crypto";

import { AsyncQueue } from "./async-queue.js";
import {
  CodexAdapterError,
  type CodexAppServerClient,
  type CodexThread,
  type CodexThreadStartOptions,
  type CodexTurn,
  type CodexTurnStartOptions,
} from "./types.js";

type Fetch = typeof globalThis.fetch;

export interface CodexResponsesNoToolClientOptions {
  apiKey?: string;
  model?: string;
  requestTimeoutMs: number;
  fetch?: Fetch;
  now?: () => Date;
  createId?: () => string;
}

const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const MAXIMUM_OUTPUT_TOKENS = 512;
const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;

interface ThreadState {
  items: unknown[];
  active?: { turnId: string; controller: AbortController; completed: boolean };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CodexAdapterError(
      "provider_protocol_failed",
      "The Codex Responses result has no output text.",
    );
  }
  return value;
}

function outputText(response: Record<string, unknown>): { itemId: string; text: string } {
  if (!Array.isArray(response.output) || response.output.length === 0) {
    throw new CodexAdapterError(
      "provider_protocol_failed",
      "The Codex Responses result has no output items.",
    );
  }
  const messages = response.output.map(record);
  if (messages.some((item) => item?.type !== "message")) {
    throw new CodexAdapterError(
      "provider_protocol_failed",
      "The no-tool Codex Responses result contained a non-message output item.",
    );
  }
  const parts = messages.flatMap((message) =>
    Array.isArray(message?.content) ? message.content.map(record) : [],
  );
  if (parts.length === 0 || parts.some((part) => part?.type !== "output_text")) {
    throw new CodexAdapterError(
      "provider_protocol_failed",
      "The no-tool Codex Responses result contained unsupported message content.",
    );
  }
  return {
    itemId:
      typeof messages[0]?.id === "string" && messages[0].id.length > 0
        ? messages[0].id
        : `msg_${randomUUID().replaceAll("-", "")}`,
    text: requiredText(parts.map((part) => part?.text).join("")),
  };
}

function usage(response: Record<string, unknown>) {
  const raw = record(response.usage);
  const inputDetails = record(raw?.input_tokens_details);
  const outputDetails = record(raw?.output_tokens_details);
  const values = {
    inputTokens: nonNegativeInteger(raw?.input_tokens),
    cachedInputTokens: nonNegativeInteger(inputDetails?.cached_tokens ?? 0),
    outputTokens: nonNegativeInteger(raw?.output_tokens),
    reasoningOutputTokens: nonNegativeInteger(outputDetails?.reasoning_tokens ?? 0),
    totalTokens: nonNegativeInteger(raw?.total_tokens),
  };
  if (Object.values(values).some((value) => value === null)) {
    throw new CodexAdapterError(
      "provider_protocol_failed",
      "The Codex Responses result has invalid usage totals.",
    );
  }
  return values as Record<keyof typeof values, number>;
}

export class CodexResponsesNoToolClient implements CodexAppServerClient {
  readonly toolBoundary = "no_tools" as const;
  private readonly notificationsQueue = new AsyncQueue<unknown>();
  private readonly threads = new Map<string, ThreadState>();
  private readonly request: Fetch;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private closed = false;

  constructor(private readonly options: CodexResponsesNoToolClientOptions) {
    this.request = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => randomUUID().replaceAll("-", ""));
  }

  async startThread(options: CodexThreadStartOptions): Promise<CodexThread> {
    this.assertAvailable();
    if (
      options.approvalPolicy !== "never" ||
      options.sandbox !== "read-only" ||
      options.selectedCapabilityRoots !== undefined ||
      record(options.config)?.mcp_servers !== undefined
    ) {
      throw new CodexAdapterError(
        "invalid_request",
        "The Codex Responses no-tool transport accepts only an isolated read-only thread.",
      );
    }
    const threadId = `responses_${this.createId()}`;
    this.threads.set(threadId, { items: [] });
    this.notificationsQueue.push({
      method: "thread/started",
      params: { thread: { id: threadId } },
      emittedAtMs: this.now().getTime(),
    });
    return { threadId };
  }

  async injectItems(threadId: string, items: readonly unknown[]): Promise<void> {
    const thread = this.thread(threadId);
    if (thread.active !== undefined) {
      throw new CodexAdapterError(
        "invalid_request",
        "Context cannot be injected while a Codex Responses turn is active.",
      );
    }
    thread.items.push(...structuredClone(items));
  }

  async startTurn(
    threadId: string,
    instructions: string,
    options: CodexTurnStartOptions = {},
  ): Promise<CodexTurn> {
    const thread = this.thread(threadId);
    if (thread.active !== undefined) {
      throw new CodexAdapterError(
        "invalid_request",
        "The Codex Responses thread already has an active turn.",
      );
    }
    const turnId = `response_turn_${this.createId()}`;
    const controller = new AbortController();
    thread.active = { turnId, controller, completed: false };
    this.notificationsQueue.push({
      method: "turn/started",
      params: { threadId, turn: { id: turnId } },
      emittedAtMs: this.now().getTime(),
    });
    void this.executeTurn(threadId, turnId, instructions, options, controller);
    return { turnId };
  }

  async respondFileChangeApproval(): Promise<void> {
    throw new CodexAdapterError(
      "provider_protocol_failed",
      "The Codex Responses no-tool transport cannot receive file-change approvals.",
    );
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    const thread = this.thread(threadId);
    if (thread.active?.turnId !== turnId || thread.active.completed) return;
    thread.active.completed = true;
    thread.active.controller.abort();
    this.notificationsQueue.push({
      method: "turn/completed",
      params: { threadId, turn: { id: turnId, status: "interrupted", durationMs: null } },
      emittedAtMs: this.now().getTime(),
    });
    delete thread.active;
  }

  async unsubscribe(threadId: string): Promise<void> {
    const thread = this.thread(threadId);
    thread.active?.controller.abort();
    this.threads.delete(threadId);
  }

  notifications(signal: AbortSignal): AsyncIterable<unknown> {
    return this.notificationsQueue.iterate(signal);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const thread of this.threads.values()) thread.active?.controller.abort();
    this.threads.clear();
    this.notificationsQueue.end();
  }

  private async executeTurn(
    threadId: string,
    turnId: string,
    instructions: string,
    options: CodexTurnStartOptions,
    controller: AbortController,
  ): Promise<void> {
    const thread = this.thread(threadId);
    const startedAt = this.now().getTime();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      timer = setTimeout(() => controller.abort(), this.options.requestTimeoutMs);
      const response = await this.request(RESPONSES_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          input: [
            ...structuredClone(thread.items),
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: instructions }],
            },
          ],
          tools: [],
          tool_choice: "none",
          store: false,
          max_output_tokens: MAXIMUM_OUTPUT_TOKENS,
          ...(options.outputSchema === undefined
            ? {}
            : {
                text: {
                  format: {
                    type: "json_schema",
                    name: "lervo_managed_selection",
                    strict: true,
                    schema: structuredClone(options.outputSchema),
                  },
                },
              }),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new CodexAdapterError(
          "provider_process_failed",
          `The Codex Responses request failed with HTTP status ${response.status}.`,
        );
      }
      const responseBody = await response.text();
      if (Buffer.byteLength(responseBody) > MAXIMUM_RESPONSE_BYTES) {
        throw new CodexAdapterError(
          "provider_protocol_failed",
          "The Codex Responses result exceeds the bounded response size.",
        );
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(responseBody) as unknown;
      } catch {
        throw new CodexAdapterError(
          "provider_protocol_failed",
          "The Codex Responses result is not valid JSON.",
        );
      }
      const raw = record(decoded);
      if (raw === null || raw.status !== "completed") {
        throw new CodexAdapterError(
          "provider_protocol_failed",
          "The Codex Responses request did not complete.",
        );
      }
      const result = outputText(raw);
      const totals = usage(raw);
      if (thread.active?.turnId !== turnId || thread.active.completed) return;
      thread.active.completed = true;
      this.notificationsQueue.push({
        method: "thread/tokenUsage/updated",
        params: {
          threadId,
          turnId,
          tokenUsage: { total: totals, modelContextWindow: null },
        },
        emittedAtMs: this.now().getTime(),
      });
      this.notificationsQueue.push({
        method: "item/completed",
        params: {
          threadId,
          turnId,
          item: { type: "agentMessage", id: result.itemId, text: result.text },
        },
        emittedAtMs: this.now().getTime(),
      });
      this.notificationsQueue.push({
        method: "turn/completed",
        params: {
          threadId,
          turn: {
            id: turnId,
            status: "completed",
            durationMs: Math.max(0, this.now().getTime() - startedAt),
          },
        },
        emittedAtMs: this.now().getTime(),
      });
      delete thread.active;
    } catch (error) {
      if (thread.active?.turnId !== turnId || thread.active.completed) return;
      thread.active.completed = true;
      this.notificationsQueue.push({
        method: "turn/completed",
        params: {
          threadId,
          turn: {
            id: turnId,
            status: "failed",
            error: {
              code: error instanceof CodexAdapterError ? error.code : "provider_process_failed",
            },
          },
        },
        emittedAtMs: this.now().getTime(),
      });
      delete thread.active;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private assertAvailable(): void {
    if (this.closed) {
      throw new CodexAdapterError(
        "provider_process_failed",
        "The Codex Responses no-tool transport is closed.",
      );
    }
    if (
      typeof this.options.apiKey !== "string" ||
      this.options.apiKey.trim().length === 0 ||
      typeof this.options.model !== "string" ||
      this.options.model.trim().length === 0
    ) {
      throw new CodexAdapterError(
        "capability_activation_failed",
        "The Codex Responses no-tool transport requires an explicit API key and model.",
      );
    }
  }

  private thread(threadId: string): ThreadState {
    this.assertAvailable();
    const thread = this.threads.get(threadId);
    if (thread === undefined) {
      throw new CodexAdapterError("session_not_found", "The Codex Responses thread was not found.");
    }
    return thread;
  }
}
