import { describe, expect, it, vi } from "vitest";

import {
  ConversationInteractionRetryLoop,
  type ConversationInteractionRetrySchedule,
} from "../src/conversation-interaction-retry-loop.js";

class RetrySchedule implements ConversationInteractionRetrySchedule {
  readonly pending: { delayMs: number; callback: () => void }[] = [];

  schedule(delayMs: number, callback: () => void): unknown {
    const item = { delayMs, callback };
    this.pending.push(item);
    return item;
  }

  cancel(handle: unknown): void {
    const index = this.pending.indexOf(handle as (typeof this.pending)[number]);
    if (index >= 0) this.pending.splice(index, 1);
  }

  runNext(): void {
    const next = this.pending.shift();
    if (next === undefined) throw new Error("No retry callback is scheduled.");
    next.callback();
  }
}

async function settled(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("conversation interaction retry loop", () => {
  it("runs immediately and waits one interval after each completed cycle", async () => {
    const schedule = new RetrySchedule();
    const runCycle = vi.fn(async () => undefined);
    const loop = new ConversationInteractionRetryLoop({
      runCycle,
      onFailure: vi.fn(),
      intervalMs: 500,
      schedule,
    });

    loop.start();
    expect(schedule.pending[0]?.delayMs).toBe(0);
    schedule.runNext();
    await settled();
    expect(runCycle).toHaveBeenCalledOnce();
    expect(schedule.pending[0]?.delayMs).toBe(500);
    loop.stop();
    expect(schedule.pending).toEqual([]);
  });

  it("stops and reports one bounded failure when a cycle throws", async () => {
    const schedule = new RetrySchedule();
    const onFailure = vi.fn();
    const loop = new ConversationInteractionRetryLoop({
      runCycle: async () => {
        throw new Error("storage unavailable");
      },
      onFailure,
      schedule,
    });

    loop.start();
    schedule.runNext();
    await settled();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(schedule.pending).toEqual([]);
  });
});
