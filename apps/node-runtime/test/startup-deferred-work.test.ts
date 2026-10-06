import { describe, expect, it } from "vitest";

import { createNodeRuntimeDeferredWork } from "../src/startup-deferred-work.js";

function manualTimer() {
  const timer = { callback: null as (() => void) | null, cancelled: false };
  return {
    timer,
    setTimer: (callback: () => void) => {
      timer.callback = callback;
      return { cancel: () => (timer.cancelled = true) };
    },
  };
}

const flush = () => new Promise<void>((resolvePromise) => setImmediate(resolvePromise));

describe("Node runtime deferred startup work", () => {
  it("holds tasks until release, runs them in order, and reports failures without stopping", async () => {
    const { timer, setTimer } = manualTimer();
    const failures: string[] = [];
    const ran: string[] = [];
    const work = createNodeRuntimeDeferredWork({
      onFailure: (name) => failures.push(name),
      setTimer,
    });
    work.schedule("first", async () => {
      ran.push("first");
      throw new Error("index unavailable");
    });
    work.schedule("second", async () => {
      ran.push("second");
    });
    await flush();
    expect(ran).toEqual([]);

    work.release();
    await flush();
    expect(ran).toEqual(["first", "second"]);
    expect(failures).toEqual(["first"]);
    expect(timer.cancelled).toBe(true);

    work.schedule("late", async () => {
      ran.push("late");
    });
    await flush();
    expect(ran).toEqual(["first", "second", "late"]);
  });

  it("releases on the bounded fallback and drops queued work once closed", async () => {
    const fallback = manualTimer();
    const ran: string[] = [];
    const work = createNodeRuntimeDeferredWork({ setTimer: fallback.setTimer });
    work.schedule("warm", async () => {
      ran.push("warm");
    });
    fallback.timer.callback?.();
    await flush();
    expect(ran).toEqual(["warm"]);

    const closing = manualTimer();
    const closed = createNodeRuntimeDeferredWork({ setTimer: closing.setTimer });
    closed.schedule("never", async () => {
      ran.push("never");
    });
    closed.close();
    closed.release();
    closing.timer.callback?.();
    await flush();
    expect(ran).toEqual(["warm"]);
    expect(closing.timer.cancelled).toBe(true);
  });
});
