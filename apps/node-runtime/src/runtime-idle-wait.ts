import type { AuthenticatedHubHttpTransport } from "@lervo/sync";

export type RuntimeChangeTransport = Pick<AuthenticatedHubHttpTransport, "waitForRuntimeChange">;

/** Coalesces hints; durable cursors, policy, and execution remain in the existing cycles. */
export class RuntimeIdleWait {
  private cursor: string | null = null;
  private pending = false;
  private wake: (() => void) | null = null;
  private retryAt = 0;

  constructor(
    private readonly options: {
      transport: () => RuntimeChangeTransport | null;
      topic: "workstream" | "command";
      nodeId?: string;
      destinationId: string;
      expectedPeerIdentityHash: string;
      fallbackIntervalMs: number;
    },
  ) {}

  notify(): void {
    this.pending = true;
    this.wake?.();
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
      const transport = Date.now() >= this.retryAt ? this.options.transport() : null;
      if (transport !== null) {
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
          )
            throw new Error("Invalid runtime hint.");
          this.cursor = value.body.cursor;
          return;
        } catch {
          if (combined.aborted) return;
          this.cursor = null;
          this.retryAt = Date.now() + 60_000;
        }
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(finish, this.options.fallbackIntervalMs);
        combined.addEventListener("abort", finish, { once: true });
        if (combined.aborted) finish();
        function finish(): void {
          clearTimeout(timer);
          combined.removeEventListener("abort", finish);
          resolve();
        }
      });
    } finally {
      this.pending = false;
      this.wake = null;
      signal.removeEventListener("abort", abort);
      controller.abort();
    }
  }
}
