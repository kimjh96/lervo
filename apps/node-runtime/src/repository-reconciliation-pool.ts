export interface RepositoryReconciliationItem {
  replicaId: string;
}

/** Bounded keyed work: a hint during one repository's run queues exactly one successor run. */
export class RepositoryReconciliationPool<T extends RepositoryReconciliationItem> {
  private readonly items: Map<string, T>;
  private readonly pendingAt = new Map<string, number>();
  private readonly active = new Map<string, Promise<void>>();
  private failure: Error | null = null;

  constructor(
    items: readonly T[],
    private readonly options: {
      concurrency: number;
      coalesceMs: number;
      reconcile(item: T): Promise<void>;
      notify(): void;
      now?: () => number;
    },
  ) {
    this.items = new Map(items.map((item) => [item.replicaId, item]));
    if (
      this.items.size !== items.length ||
      !Number.isSafeInteger(options.concurrency) ||
      options.concurrency < 1 ||
      !Number.isSafeInteger(options.coalesceMs) ||
      options.coalesceMs < 0
    ) {
      throw new Error("The repository reconciliation pool configuration is invalid.");
    }
  }

  notify(replicaId: string): void {
    if (!this.items.has(replicaId))
      throw new Error("The repository reconciliation hint is not configured.");
    const eligibleAt = (this.options.now ?? Date.now)() + this.options.coalesceMs;
    this.pendingAt.set(replicaId, Math.max(this.pendingAt.get(replicaId) ?? 0, eligibleAt));
    this.options.notify();
  }

  notifyAll(): void {
    const now = (this.options.now ?? Date.now)();
    for (const replicaId of this.items.keys()) {
      this.pendingAt.set(replicaId, Math.min(this.pendingAt.get(replicaId) ?? now, now));
    }
    this.options.notify();
  }

  startReady(): number {
    if (this.failure !== null) throw this.failure;
    const now = (this.options.now ?? Date.now)();
    let started = 0;
    for (const [replicaId, eligibleAt] of this.pendingAt) {
      if (this.active.size >= this.options.concurrency) break;
      if (eligibleAt > now || this.active.has(replicaId)) continue;
      const item = this.items.get(replicaId)!;
      this.pendingAt.delete(replicaId);
      const operation = Promise.resolve()
        .then(() => this.options.reconcile(item))
        .catch((error: unknown) => {
          this.failure ??=
            error instanceof Error
              ? error
              : new Error("Repository reconciliation failed.", { cause: error });
        })
        .finally(() => {
          this.active.delete(replicaId);
          this.options.notify();
        });
      this.active.set(replicaId, operation);
      started += 1;
    }
    return started;
  }

  nextReadyAt(): number | null {
    if (this.active.size >= this.options.concurrency) return null;
    const candidates = [...this.pendingAt]
      .filter(([replicaId]) => !this.active.has(replicaId))
      .map(([, eligibleAt]) => eligibleAt);
    return candidates.length === 0 ? null : Math.min(...candidates);
  }

  error(): Error | null {
    return this.failure;
  }

  idle(): boolean {
    return this.pendingAt.size === 0 && this.active.size === 0;
  }

  async settle(): Promise<void> {
    await Promise.all(this.active.values());
  }
}
