import { AsyncLocalStorage } from "node:async_hooks";

/** Tracks admitted application work so shutdown cannot close stores during an active turn. */
export class ConversationOperationDrain {
  private accepting = true;
  private readonly scope = new AsyncLocalStorage<symbol>();
  private readonly activeScopes = new Set<symbol>();
  private readonly operations = new Set<Promise<unknown>>();
  private readonly waiters = new Set<() => void>();

  get activeCount(): number {
    return this.operations.size;
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const parent = this.scope.getStore();
    if (!this.accepting && (parent === undefined || !this.activeScopes.has(parent))) {
      return Promise.reject(new Error("Conversation operation admission is closed."));
    }
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
    this.accepting = false;
  }

  drain(): Promise<void> {
    if (this.operations.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.add(resolve));
  }
}
