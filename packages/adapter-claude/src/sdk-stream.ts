import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import { ClaudeAdapterError } from "./types.js";
import { asRecord } from "./normalization-utils.js";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface PendingReplay extends Deferred {
  expectedContent: string;
  shouldQuery: boolean;
  lifecycleStarted: boolean;
}

function deferred(): Deferred {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function messageText(value: unknown): string | undefined {
  const message = asRecord(asRecord(value)?.message);
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const texts = content.map((block) => {
    const item = asRecord(block);
    return item?.type === "text" && typeof item.text === "string" ? item.text : undefined;
  });
  return texts.every((text) => text !== undefined) ? texts.join("") : undefined;
}

export class ClaudeInputStream implements AsyncIterable<SDKUserMessage> {
  private readonly values: SDKUserMessage[] = [];
  private readonly waiters = new Set<() => void>();
  private ended = false;

  push(value: SDKUserMessage): void {
    if (this.ended)
      throw new ClaudeAdapterError("session_stopped", "The Claude input stream has ended.");
    this.values.push(value);
    this.wake();
  }

  end(): void {
    this.ended = true;
    this.wake();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      if (this.values.length > 0) {
        yield this.values.shift() as SDKUserMessage;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((resolve) => this.waiters.add(resolve));
    }
  }

  private wake(): void {
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      waiter();
    }
  }
}

export class ClaudeReplayTracker {
  private readonly initialized = deferred();
  private readonly pending = new Map<string, PendingReplay>();

  constructor(
    private readonly providerSessionId: string,
    private readonly timeoutMs: number,
  ) {}

  expect(uuid: string, expectedContent: string, shouldQuery: boolean): Promise<void> {
    if (this.pending.has(uuid)) {
      throw new ClaudeAdapterError(
        "provider_protocol_failed",
        "The Claude input UUID is duplicated.",
      );
    }
    const replay = { ...deferred(), expectedContent, shouldQuery, lifecycleStarted: false };
    this.pending.set(uuid, replay);
    return Promise.all([
      this.withTimeout(
        this.initialized.promise,
        "Claude initialization acknowledgement timed out.",
      ),
      this.withTimeout(replay.promise, "Claude input acknowledgement timed out."),
    ]).then(() => undefined);
  }

  accept(message: SDKMessage): boolean {
    const value = asRecord(message);
    const sessionId = value?.session_id;
    if (typeof sessionId === "string" && sessionId !== this.providerSessionId) {
      throw new ClaudeAdapterError(
        "provider_protocol_failed",
        "The Claude message session ID does not match.",
      );
    }
    if (value?.type === "system" && value.subtype === "init") {
      this.initialized.resolve();
      return false;
    }
    if (value?.type === "command_lifecycle" && typeof value.command_uuid === "string") {
      const pending = this.pending.get(value.command_uuid);
      if (pending !== undefined) {
        if (pending.shouldQuery === false) {
          if (value.state === "started") {
            pending.lifecycleStarted = true;
            pending.resolve();
          } else if (value.state === "completed") {
            this.pending.delete(value.command_uuid);
            pending.resolve();
          }
          return true;
        }
        if (value.state === "started") {
          this.pending.delete(value.command_uuid);
          pending.resolve();
        }
      }
    }
    if (
      value?.type === "result" &&
      value.subtype === "success" &&
      value.is_error === false &&
      value.num_turns === 0 &&
      value.user_message_uuid === undefined &&
      [...this.pending.values()].filter(
        (pending) => pending.shouldQuery === false && pending.lifecycleStarted,
      ).length === 1
    ) {
      return true;
    }
    if (
      value?.type === "result" &&
      value.subtype === "success" &&
      value.is_error === false &&
      typeof value.user_message_uuid === "string"
    ) {
      const pending = this.pending.get(value.user_message_uuid);
      if (pending !== undefined && pending.shouldQuery === false) {
        this.pending.delete(value.user_message_uuid);
        pending.resolve();
        return true;
      }
    }
    if (value?.type !== "user" || value.isReplay !== true || typeof value.uuid !== "string") {
      return false;
    }
    const pending = this.pending.get(value.uuid);
    if (pending === undefined) return false;
    this.pending.delete(value.uuid);
    if (messageText(value) !== pending.expectedContent) {
      pending.reject(
        new ClaudeAdapterError(
          "provider_protocol_failed",
          "The input acknowledged by Claude differs from the input sent.",
        ),
      );
      return false;
    }
    pending.resolve();
    return false;
  }

  fail(error: Error): void {
    this.initialized.reject(error);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private async withTimeout(promise: Promise<void>, message: string): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    const expired = new Promise<void>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new ClaudeAdapterError("provider_protocol_failed", message)),
        this.timeoutMs,
      );
    });
    try {
      await Promise.race([promise, expired]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
