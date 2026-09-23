import { AsyncLocalStorage } from "node:async_hooks";

export interface ConversationOperationAdmissionPort {
  tryAcquire(): unknown | null;
  release(claim: unknown): void;
}

const MAXIMUM_QUEUED_OPERATIONS = 256;

/** Tracks admitted application work so shutdown cannot close stores during an active turn. */
export class ConversationOperationDrain {
  private state: "open" | "draining" = "open";
  private readonly scope = new AsyncLocalStorage<symbol>();
  private readonly activeScopes = new Set<symbol>();
  private readonly operations = new Set<Promise<unknown>>();
  private readonly waiters = new Set<() => void>();
  private readonly retryWaiters = new Map<ReturnType<typeof setTimeout>, (error: Error) => void>();
  private queuedAdmissions = 0;

  constructor(private readonly admission?: ConversationOperationAdmissionPort) {}

  get activeCount(): number {
    return this.operations.size;
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const parent = this.scope.getStore();
    if (parent === undefined || !this.activeScopes.has(parent)) {
      if (this.state === "draining") {
        return Promise.reject(new Error("Conversation operation admission is closed."));
      }
    }
    return this.admission === undefined
      ? this.start(operation)
      : this.startWithAdmission(operation);
  }

  private async startWithAdmission<T>(operation: () => Promise<T>): Promise<T> {
    let queued = false;
    try {
      for (;;) {
        const parent = this.scope.getStore();
        if (this.state === "draining" && (parent === undefined || !this.activeScopes.has(parent))) {
          throw new Error("Conversation operation admission is closed.");
        }
        const claim = this.admission!.tryAcquire();
        if (claim !== null) {
          if (queued) {
            this.queuedAdmissions -= 1;
            queued = false;
          }
          return this.start(async () => {
            try {
              return await operation();
            } finally {
              this.admission!.release(claim);
            }
          });
        }
        if (!queued) {
          if (this.queuedAdmissions >= MAXIMUM_QUEUED_OPERATIONS) {
            throw new Error("Conversation operation admission is saturated.");
          }
          this.queuedAdmissions += 1;
          queued = true;
        }
        await this.waitForAdmissionRetry();
      }
    } finally {
      if (queued) this.queuedAdmissions -= 1;
    }
  }

  private waitForAdmissionRetry(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.retryWaiters.delete(timer);
        resolve();
      }, 100);
      this.retryWaiters.set(timer, reject);
    });
  }

  private start<T>(operation: () => Promise<T>): Promise<T> {
    const token = Symbol("conversation-operation");
    this.activeScopes.add(token);
    const active = this.scope.run(token, () => Promise.resolve().then(operation));
    this.operations.add(active);
    void active
      .finally(() => {
        this.operations.delete(active);
        this.activeScopes.delete(token);
        if (this.operations.size === 0) {
          for (const resolve of this.waiters) resolve();
          this.waiters.clear();
        }
      })
      .catch(() => undefined);
    return active;
  }

  stop(): void {
    this.state = "draining";
    for (const [timer, reject] of this.retryWaiters) {
      clearTimeout(timer);
      reject(new Error("Conversation operation admission is closed."));
    }
    this.retryWaiters.clear();
  }

  drain(): Promise<void> {
    if (this.operations.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.add(resolve));
  }
}
