import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import { ClaudeAdapterError } from "./types.js";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface PendingReplay extends Deferred {
  expectedContent: string;
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

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function messageText(value: unknown): string | undefined {
  const message = record(record(value)?.message);
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const texts = content.map((block) => {
    const item = record(block);
    return item?.type === "text" && typeof item.text === "string" ? item.text : undefined;
  });
  return texts.every((text) => text !== undefined) ? texts.join("") : undefined;
}

export class ClaudeInputStream implements AsyncIterable<SDKUserMessage> {
  private readonly values: SDKUserMessage[] = [];
  private readonly waiters = new Set<() => void>();
  private ended = false;

  push(value: SDKUserMessage): void {
    if (this.ended) throw new ClaudeAdapterError("session_stopped", "종료된 Claude 입력 stream입니다.");
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

  expect(uuid: string, expectedContent: string): Promise<void> {
    if (this.pending.has(uuid)) {
      throw new ClaudeAdapterError("provider_protocol_failed", "Claude input UUID가 중복되었습니다.");
    }
    const replay = { ...deferred(), expectedContent };
    this.pending.set(uuid, replay);
    return Promise.all([
      this.withTimeout(this.initialized.promise, "Claude init 확인 시간이 초과되었습니다."),
      this.withTimeout(replay.promise, "Claude 입력 확인 시간이 초과되었습니다."),
    ]).then(() => undefined);
  }

  accept(message: SDKMessage): void {
    const value = record(message);
    const sessionId = value?.session_id;
    if (typeof sessionId === "string" && sessionId !== this.providerSessionId) {
      throw new ClaudeAdapterError("provider_protocol_failed", "Claude message의 session ID가 다릅니다.");
    }
    if (value?.type === "system" && value.subtype === "init") {
      this.initialized.resolve();
      return;
    }
    if (value?.type !== "user" || value.isReplay !== true || typeof value.uuid !== "string") return;
    const pending = this.pending.get(value.uuid);
    if (pending === undefined) return;
    this.pending.delete(value.uuid);
    if (messageText(value) !== pending.expectedContent) {
      pending.reject(
        new ClaudeAdapterError("provider_protocol_failed", "Claude가 확인한 입력이 보낸 입력과 다릅니다."),
      );
      return;
    }
    pending.resolve();
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
