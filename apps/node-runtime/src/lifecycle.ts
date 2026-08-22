import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { type OutboundSyncLoopResult } from "@lervo/sync";

import { type RemoteControlLoopResult } from "./control-loop.js";
import { NodeRuntimeError } from "./errors.js";

export interface NodeRuntimeCloseResult {
  status: "stopped" | "failed";
  failureCode?: "sync_runtime_failed" | "remote_control_runtime_failed";
  sync: OutboundSyncLoopResult | null;
  remoteControl: RemoteControlLoopResult | null;
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
  private syncLoop: Promise<OutboundSyncLoopResult> | null = null;
  private controlLoop: Promise<RemoteControlLoopResult> | null = null;
  private closePromise: Promise<NodeRuntimeCloseResult> | null = null;
  private failureCode: NodeRuntimeCloseResult["failureCode"];
  private resolveClosed!: (result: NodeRuntimeCloseResult) => void;
  private rejectClosed!: (error: unknown) => void;

  constructor(
    private readonly store: SQLiteEventStore,
    private readonly runSyncLoop: (signal: AbortSignal) => Promise<OutboundSyncLoopResult>,
    private readonly control: {
      run(signal: AbortSignal): Promise<RemoteControlLoopResult>;
      close(): void;
    } | null,
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
    this.syncLoop = Promise.resolve().then(() => this.runSyncLoop(this.abort.signal));
    void this.syncLoop.catch(() => {
      this.failureCode ??= "sync_runtime_failed";
      void this.close();
    });
    const control = this.control;
    if (control !== null) {
      this.controlLoop = Promise.resolve().then(() => control.run(this.abort.signal));
      void this.controlLoop.catch(() => {
        this.failureCode ??= "remote_control_runtime_failed";
        void this.close();
      });
    }
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
    let remoteControl: RemoteControlLoopResult | null = null;
    try {
      if (this.syncLoop !== null) sync = await this.syncLoop;
    } catch {
      this.failureCode ??= "sync_runtime_failed";
    }
    try {
      if (this.controlLoop !== null) remoteControl = await this.controlLoop;
    } catch {
      this.failureCode ??= "remote_control_runtime_failed";
    }
    const shutdownErrors: unknown[] = [];
    try {
      this.control?.close();
    } catch (error) {
      shutdownErrors.push(error);
    }
    try {
      this.store.close();
    } catch (error) {
      shutdownErrors.push(error);
    }
    if (shutdownErrors.length > 0) {
      throw new NodeRuntimeError(
        "shutdown_failed",
        "Node runtime 저장소를 안전하게 종료하지 못했습니다.",
        { cause: new AggregateError(shutdownErrors) },
      );
    }
    return this.failureCode === undefined
      ? { status: "stopped", sync, remoteControl }
      : { status: "failed", failureCode: this.failureCode, sync, remoteControl };
  }
}

export function createNodeRuntimeDeployment(
  store: SQLiteEventStore,
  runLoop: (signal: AbortSignal) => Promise<OutboundSyncLoopResult>,
  control: {
    run(signal: AbortSignal): Promise<RemoteControlLoopResult>;
    close(): void;
  } | null = null,
): NodeRuntimeDeployment {
  return new DefaultNodeRuntimeDeployment(store, runLoop, control);
}
