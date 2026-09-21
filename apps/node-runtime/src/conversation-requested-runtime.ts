export interface ConversationRequestedRuntimeTarget {
  runtimeId: string;
  displayName: string;
  executable: string;
  arguments: string[];
  workingDirectory: string;
  maximumLifetimeMs: number;
  startupTimeoutMs: number;
  stopTimeoutMs: number;
  healthUrl?: string;
}

export interface ConversationRequestedRuntimeProcess {
  readonly exited: Promise<{ exitCode: number | null; signal: string | null }>;
  stop(timeoutMs: number): Promise<void>;
}

export interface ConversationRequestedRuntimeProcessPort {
  start(target: ConversationRequestedRuntimeTarget): Promise<ConversationRequestedRuntimeProcess>;
}

export type ConversationRequestedRuntimeOpenResult = "opened" | "already_open";
export type ConversationRequestedRuntimeCloseResult = "closed" | "already_closed";

interface ActiveRuntime {
  process: ConversationRequestedRuntimeProcess;
  lifetime: ReturnType<typeof setTimeout>;
}

/** Owns request-scoped processes for this Node lifetime; it never restarts or boot-enables them. */
export class ConversationRequestedRuntimeManager {
  private readonly targets: ReadonlyMap<string, ConversationRequestedRuntimeTarget>;
  private readonly active = new Map<string, ActiveRuntime>();
  private readonly opening = new Map<string, Promise<void>>();
  private readonly closing = new Map<string, Promise<void>>();

  constructor(
    targets: readonly ConversationRequestedRuntimeTarget[],
    private readonly processes: ConversationRequestedRuntimeProcessPort,
  ) {
    this.targets = new Map(targets.map((target) => [target.runtimeId, target]));
  }

  target(runtimeId: string): ConversationRequestedRuntimeTarget {
    const target = this.targets.get(runtimeId);
    if (target === undefined) throw new Error("The requested runtime target is not configured.");
    return target;
  }

  async open(runtimeId: string): Promise<ConversationRequestedRuntimeOpenResult> {
    const target = this.target(runtimeId);
    const closing = this.closing.get(runtimeId);
    if (closing !== undefined) await closing;
    if (this.active.has(runtimeId)) return "already_open";
    const opening = this.opening.get(runtimeId);
    if (opening !== undefined) {
      await opening;
      return "already_open";
    }
    const next = this.processes.start(target).then((process) => {
      const lifetime = setTimeout(() => {
        void this.close(runtimeId).catch(() => undefined);
      }, target.maximumLifetimeMs);
      lifetime.unref?.();
      const active = { process, lifetime };
      this.active.set(runtimeId, active);
      void process.exited.finally(async () => {
        if (this.active.get(runtimeId) !== active) return;
        clearTimeout(lifetime);
        if (!this.closing.has(runtimeId)) {
          await process.stop(target.stopTimeoutMs).catch(() => undefined);
        }
        this.active.delete(runtimeId);
      });
    });
    this.opening.set(runtimeId, next);
    try {
      await next;
      return "opened";
    } finally {
      if (this.opening.get(runtimeId) === next) this.opening.delete(runtimeId);
    }
  }

  async close(runtimeId: string): Promise<ConversationRequestedRuntimeCloseResult> {
    const target = this.target(runtimeId);
    const opening = this.opening.get(runtimeId);
    if (opening !== undefined) await opening;
    const closing = this.closing.get(runtimeId);
    if (closing !== undefined) {
      await closing;
      return "closed";
    }
    const active = this.active.get(runtimeId);
    if (active === undefined) return "already_closed";
    clearTimeout(active.lifetime);
    const next = active.process.stop(target.stopTimeoutMs).then(() => {
      if (this.active.get(runtimeId) === active) this.active.delete(runtimeId);
    });
    this.closing.set(runtimeId, next);
    try {
      await next;
      return "closed";
    } finally {
      if (this.closing.get(runtimeId) === next) this.closing.delete(runtimeId);
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.opening.values());
    await Promise.all([...this.active.keys()].map((runtimeId) => this.close(runtimeId)));
  }
}
