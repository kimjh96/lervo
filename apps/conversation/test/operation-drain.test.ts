import { describe, expect, it } from "vitest";

import { ConversationOperationDrain } from "../src/operation-drain.js";

describe("conversation operation drain", () => {
  it("rejects new work after stop and waits for every admitted operation", async () => {
    const drain = new ConversationOperationDrain();
    let completeFirst!: () => void;
    let failSecond!: (error: Error) => void;
    const firstGate = new Promise<void>((resolve) => (completeFirst = resolve));
    const secondGate = new Promise<void>((_resolve, reject) => (failSecond = reject));
    const first = drain.run(() => firstGate);
    const second = drain.run(() => secondGate);
    expect(drain.activeCount).toBe(2);

    drain.stop();
    await expect(drain.run(async () => undefined)).rejects.toThrow("admission is closed");
    let settled = false;
    const waiting = drain.drain().then(() => (settled = true));
    completeFirst();
    await first;
    expect(settled).toBe(false);

    failSecond(new Error("provider failed"));
    await expect(second).rejects.toThrow("provider failed");
    await waiting;
    expect(settled).toBe(true);
    expect(drain.activeCount).toBe(0);
  });

  it("allows a previously admitted turn to finish nested work after admission closes", async () => {
    const drain = new ConversationOperationDrain();
    let continueTurn!: () => void;
    const gate = new Promise<void>((resolve) => (continueTurn = resolve));
    const turn = drain.run(async () => {
      await gate;
      return drain.run(async () => "completed");
    });
    drain.stop();
    continueTurn();
    await expect(turn).resolves.toBe("completed");
    await drain.drain();
    await expect(drain.run(async () => "late")).rejects.toThrow("admission is closed");
  });
});
