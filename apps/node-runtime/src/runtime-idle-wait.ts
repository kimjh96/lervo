import type { AuthenticatedHubHttpTransport } from "@lervo/sync";

export type RuntimeChangeTransport = Pick<AuthenticatedHubHttpTransport, "waitForRuntimeChange">;

/** A failed hint wait retries after the fallback interval, doubling to this ceiling. */
export const RUNTIME_HINT_RETRY_CEILING_MILLISECONDS = 5 * 60_000;

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = Number.isFinite(milliseconds) ? setTimeout(finish, milliseconds) : null;
    signal.addEventListener("abort", finish, { once: true });
    function finish(): void {
      if (timer !== null) clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

/**
 * Coalesces hints; durable cursors, policy, and execution remain in the existing cycles.
 * ADR-0602: a wait is an open hold on the Hub, answered only when Hub state changed, so an idle
 * Node arms no timer and makes no request; a local `notify` ends it at once. A failed wait
 * retries after `fallbackIntervalMs`, doubling to a ceiling, and `onAvailability` reports the
 * failure until the next answer. Without a hint-capable transport it waits for local changes
 * only, and reports that once.
 */
export class RuntimeIdleWait {
  private cursor: string | null = null;
  private pending = false;
  private wake: (() => void) | null = null;
  private failures = 0;
  private retryAt = 0;
  private unavailable = false;

  constructor(
    private readonly options: {
      transport: () => RuntimeChangeTransport | null;
      topic: "workstream" | "command";
      nodeId?: string;
      destinationId: string;
      expectedPeerIdentityHash: string;
      fallbackIntervalMs: number;
      retryCeilingMs?: number;
      /** A failure while hints are unavailable, then null once a wait is answered again. */
      onAvailability?: (failure: unknown) => void;
    },
  ) {}

  notify(): void {
    this.pending = true;
    this.wake?.();
  }

  private report(failure: unknown): void {
    const unavailable = failure !== null;
    if (unavailable === this.unavailable && !unavailable) return;
    this.unavailable = unavailable;
    this.options.onAvailability?.(failure);
  }

  private retryDelay(): number {
    const ceiling = this.options.retryCeilingMs ?? RUNTIME_HINT_RETRY_CEILING_MILLISECONDS;
    return Math.min(
      ceiling,
      this.options.fallbackIntervalMs * 2 ** Math.min(Math.max(0, this.failures - 1), 30),
    );
  }

  async wait(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    if (this.pending) {
      this.pending = false;
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    this.wake = abort;
    const combined = controller.signal;
    try {
      const now = Date.now();
      // A failure's backoff is still running: sleep it out, then let the cycle look once.
      if (now < this.retryAt) return await sleep(this.retryAt - now, combined);
      const transport = this.options.transport();
      if (transport === null) {
        if (!this.unavailable)
          this.report(
            Object.assign(new Error("The Hub transport cannot wait for changes."), {
              code: "hub_hints_unsupported",
            }),
          );
        return await sleep(Number.POSITIVE_INFINITY, combined);
      }
      try {
        const result = await transport.waitForRuntimeChange({
          topic: this.options.topic,
          ...(this.options.nodeId === undefined ? {} : { nodeId: this.options.nodeId }),
          cursor: this.cursor,
          signal: combined,
        });
        if (combined.aborted) return;
        const value = result as {
          authentication?: { status?: string; destinationId?: string; peerIdentityHash?: string };
          body?: { schemaVersion?: number; cursor?: string; status?: string };
        };
        if (
          value?.authentication?.status !== "verified" ||
          value.authentication.destinationId !== this.options.destinationId ||
          value.authentication.peerIdentityHash !== this.options.expectedPeerIdentityHash ||
          value.body?.schemaVersion !== 1 ||
          typeof value.body.cursor !== "string" ||
          !/^[a-f0-9-]{36}$/.test(value.body.cursor) ||
          (value.body.status !== "changed" && value.body.status !== "timeout")
        ) {
          this.cursor = null;
          throw new Error("Invalid runtime hint.");
        }
        this.cursor = value.body.cursor;
        this.failures = 0;
        this.retryAt = 0;
        if (this.unavailable) this.report(null);
      } catch (error) {
        if (combined.aborted) return;
        // The cursor survives a transport failure: the same Hub holds again without a change.
        this.failures = Math.min(this.failures + 1, 64);
        const delay = this.retryDelay();
        this.retryAt = Date.now() + delay;
        this.report(error);
        await sleep(delay, combined);
      }
    } finally {
      this.pending = false;
      this.wake = null;
      signal.removeEventListener("abort", abort);
      controller.abort();
    }
  }
}
