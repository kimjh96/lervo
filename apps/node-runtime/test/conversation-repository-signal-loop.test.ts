import { describe, expect, it, vi } from "vitest";

import {
  ConversationRepositorySignalLoop,
  type ConversationRepositorySignalSchedule,
} from "../src/conversation-repository-signal-loop.js";

describe("conversation repository signal loop", () => {
  it("runs immediately, repeats on its bound interval, and stops after failure", async () => {
    const callbacks: Array<() => void> = [];
    const schedule: ConversationRepositorySignalSchedule = {
      schedule: vi.fn((_delay, callback) => callbacks.push(callback)),
      cancel: vi.fn(),
    };
    const runCycle = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error());
    const onFailure = vi.fn();
    const loop = new ConversationRepositorySignalLoop({
      runCycle,
      onFailure,
      intervalMs: 500,
      schedule,
    });
    loop.start();
    expect(schedule.schedule).toHaveBeenNthCalledWith(1, 0, expect.any(Function));
    callbacks.shift()!();
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(1));
    expect(schedule.schedule).toHaveBeenNthCalledWith(2, 500, expect.any(Function));
    callbacks.shift()!();
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1));
    expect(schedule.schedule).toHaveBeenCalledTimes(2);
    await loop.stop();
  });
});
