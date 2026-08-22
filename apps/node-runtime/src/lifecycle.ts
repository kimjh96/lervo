import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { type OutboundSyncLoopResult } from "@lervo/sync";

import { NodeRuntimeError } from "./errors.js";

export interface NodeRuntimeCloseResult {
  status: "stopped" | "failed";
  failureCode?: "sync_runtime_failed";
  sync: OutboundSyncLoopResult | null;
}

export interface NodeRuntimeDeployment {
  readonly closed: Promise<NodeRuntimeCloseResult>;
  start(): Promise<void>;
  close(): Promise<NodeRuntimeCloseResult>;
}

class DefaultNodeRuntimeDeployment implements NodeRuntimeDeployment {
  readonly closed: Promise<NodeRuntimeCloseResult>;
  private readonly abort = new AbortController();
  private started = false;
  private loop: Promise<OutboundSyncLoopResult> | null = null;
  private closePromise: Promise<NodeRuntimeCloseResult> | null = null;
  private failureCode: NodeRuntimeCloseResult["failureCode"];
  private resolveClosed!: (result: NodeRuntimeCloseResult) => void;
  private rejectClosed!: (error: unknown) => void;

  constructor(
    private readonly store: SQLiteEventStore,
    private readonly runLoop: (signal: AbortSignal) => Promise<OutboundSyncLoopResult>,
  ) {
    this.closed = new Promise<NodeRuntimeCloseResult>((resolve, reject) => {
      this.resolveClosed = resolve;
      this.rejectClosed = reject;
    });
  }

  async start(): Promise<void> {
    if (this.started || this.closePromise !== null) {
      throw new NodeRuntimeError("startup_failed", "Node runtime은 한 번만 시작할 수 있습니다.");
    }
    this.started = true;
    this.loop = this.runLoop(this.abort.signal);
    void this.loop.catch(() => {
      this.failureCode = "sync_runtime_failed";
      void this.close();
    });
  }

  close(): Promise<NodeRuntimeCloseResult> {
    if (this.closePromise === null) {
      this.abort.abort();
      this.closePromise = this.finish();
      void this.closePromise.then(this.resolveClosed, this.rejectClosed);
    }
    return this.closePromise;
  }

  private async finish(): Promise<NodeRuntimeCloseResult> {
    let sync: OutboundSyncLoopResult | null = null;
    try {
      if (this.loop !== null) sync = await this.loop;
    } catch {
      this.failureCode = "sync_runtime_failed";
    }
    try {
      this.store.close();
    } catch (error) {
      throw new NodeRuntimeError(
        "shutdown_failed",
        "Node runtime event store를 안전하게 종료하지 못했습니다.",
        { cause: error },
      );
    }
    return this.failureCode === undefined
      ? { status: "stopped", sync }
      : { status: "failed", failureCode: this.failureCode, sync };
  }
}

export function createNodeRuntimeDeployment(
  store: SQLiteEventStore,
  runLoop: (signal: AbortSignal) => Promise<OutboundSyncLoopResult>,
): NodeRuntimeDeployment {
  return new DefaultNodeRuntimeDeployment(store, runLoop);
}
