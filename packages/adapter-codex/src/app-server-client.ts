import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import { AsyncQueue } from "./async-queue.js";
import {
  CodexAdapterError,
  type CodexAppServerClient,
  type CodexThread,
  type CodexThreadStartOptions,
  type CodexTurn,
  type CodexTurnStartOptions,
} from "./types.js";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface StdioClientOptions {
  executable: string;
  commandArguments?: readonly string[];
  cwd: string;
  requestTimeoutMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new CodexAdapterError(
      "provider_protocol_failed",
      "The Codex response has an invalid shape.",
    );
  }
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CodexAdapterError(
      "provider_protocol_failed",
      "The Codex response identifier is missing.",
    );
  }
  return value;
}

export class CodexStdioAppServerClient implements CodexAppServerClient {
  private readonly notificationsQueue = new AsyncQueue<unknown>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly pendingFileApprovals = new Set<string | number>();
  private nextRequestId = 1;
  private closed = false;
  private exited = false;
  private processStateUnavailable = false;

  private constructor(
    private readonly process: ChildProcessWithoutNullStreams,
    private readonly requestTimeoutMs: number,
  ) {
    process.stderr.resume();
    const lines = createInterface({ input: process.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.receiveLine(line));
    process.once("error", () => this.failProcess(false));
    process.once("exit", () => this.failProcess(true));
  }

  static async connect(options: StdioClientOptions): Promise<CodexStdioAppServerClient> {
    const child = spawn(options.executable, options.commandArguments ?? ["app-server", "--stdio"], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const client = new CodexStdioAppServerClient(child, options.requestTimeoutMs);
    try {
      await client.request("initialize", {
        clientInfo: { name: "lervo", title: "Lervo", version: "0.0.0" },
        capabilities: null,
      });
      client.notify("initialized");
      return client;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  inspectProcess() {
    if (this.exited || this.process.exitCode !== null || this.process.signalCode !== null) {
      return { status: "exited" as const, evidence: "owned_process_state" as const };
    }
    if (this.processStateUnavailable) {
      return {
        status: "unobservable" as const,
        evidence: "transport_state_unavailable" as const,
      };
    }
    return { status: "running" as const, evidence: "owned_process_state" as const };
  }

  async startThread(options: CodexThreadStartOptions): Promise<CodexThread> {
    const result = requiredRecord(
      await this.request("thread/start", {
        cwd: options.cwd,
        approvalPolicy: options.approvalPolicy,
        sandbox: options.sandbox,
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.baseInstructions === undefined
          ? {}
          : { baseInstructions: options.baseInstructions }),
        ...(options.config === undefined ? {} : { config: structuredClone(options.config) }),
        ...(options.selectedCapabilityRoots === undefined
          ? {}
          : { selectedCapabilityRoots: structuredClone(options.selectedCapabilityRoots) }),
      }),
    );
    const thread = requiredRecord(result.thread);
    return { threadId: requiredString(thread.id) };
  }

  async listConnectedMcpServers(threadId: string): Promise<string[]> {
    const result = requiredRecord(
      await this.request("mcpServerStatus/list", {
        threadId,
        detail: "toolsAndAuthOnly",
      }),
    );
    if (!Array.isArray(result.data)) {
      throw new CodexAdapterError(
        "provider_protocol_failed",
        "The Codex MCP status response is invalid.",
      );
    }
    return result.data.flatMap((item) => {
      if (!isRecord(item) || typeof item.name !== "string") {
        throw new CodexAdapterError(
          "provider_protocol_failed",
          "The Codex MCP server status is invalid.",
        );
      }
      return isRecord(item.serverInfo) ? [item.name] : [];
    });
  }

  async injectItems(threadId: string, items: readonly unknown[]): Promise<void> {
    await this.request("thread/inject_items", { threadId, items: structuredClone(items) });
  }

  async startTurn(
    threadId: string,
    instructions: string,
    options: CodexTurnStartOptions = {},
  ): Promise<CodexTurn> {
    const result = requiredRecord(
      await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: instructions }],
        ...(options.reasoningEffort === undefined ? {} : { effort: options.reasoningEffort }),
        ...(options.outputSchema === undefined
          ? {}
          : { outputSchema: structuredClone(options.outputSchema) }),
      }),
    );
    const turn = requiredRecord(result.turn);
    return { turnId: requiredString(turn.id) };
  }

  async respondFileChangeApproval(
    requestId: string | number,
    decision: "accept" | "decline",
  ): Promise<void> {
    if (!this.pendingFileApprovals.delete(requestId)) {
      throw new CodexAdapterError(
        "provider_protocol_failed",
        "The Codex file-change approval request is missing or has already been handled.",
      );
    }
    this.write({ id: requestId, result: { decision } });
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.request("turn/interrupt", { threadId, turnId });
  }

  async unsubscribe(threadId: string): Promise<void> {
    await this.request("thread/unsubscribe", { threadId });
  }

  notifications(signal: AbortSignal): AsyncIterable<unknown> {
    return this.notificationsQueue.iterate(signal);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.process.stdin.end();
    if (this.exited) return;
    this.process.kill("SIGTERM");
    const exited = new Promise<void>((resolve) => this.process.once("exit", () => resolve()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        exited,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1_000);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (!this.exited) this.process.kill("SIGKILL");
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed || this.exited) {
      return Promise.reject(
        new CodexAdapterError("provider_process_failed", "The Codex app-server has stopped."),
      );
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new CodexAdapterError(
            "provider_protocol_failed",
            "The Codex app-server response timed out.",
          ),
        );
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ method, id, params });
    });
  }

  private notify(method: string): void {
    this.write({ method });
  }

  private write(message: unknown): void {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receiveLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      this.failProtocol();
      return;
    }
    if (!isRecord(message)) {
      this.failProtocol();
      return;
    }
    if (typeof message.id === "number" && !Object.hasOwn(message, "method")) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (Object.hasOwn(message, "error")) {
        pending.reject(
          new CodexAdapterError(
            "provider_protocol_failed",
            "The Codex app-server request was rejected.",
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method === "string") {
      if (
        message.method === "item/fileChange/requestApproval" &&
        (typeof message.id === "number" || typeof message.id === "string")
      ) {
        this.pendingFileApprovals.add(message.id);
      } else if (typeof message.id === "number" || typeof message.id === "string") {
        this.rejectServerRequest(message);
      }
      this.notificationsQueue.push(structuredClone(message));
    }
  }

  private rejectServerRequest(message: Record<string, unknown>): void {
    const id = message.id;
    this.write({ id, error: { code: -32601, message: "Unsupported managed server request" } });
  }

  private failProtocol(): void {
    const error = new CodexAdapterError(
      "provider_protocol_failed",
      "The Codex app-server sent an invalid protocol message.",
    );
    this.rejectPending(error);
    this.notificationsQueue.fail(error);
  }

  private failProcess(didExit: boolean): void {
    if (this.exited) return;
    this.exited = didExit;
    this.processStateUnavailable ||= !didExit;
    const error = new CodexAdapterError(
      "provider_process_failed",
      "The Codex app-server process has exited.",
    );
    this.rejectPending(error);
    if (this.closed) this.notificationsQueue.end();
    else this.notificationsQueue.fail(error);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}
