import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeChangeNotifications } from "../src/runtime-change-notifications.js";

const scope = {
  topic: "workstream" as const,
  projectId: "prj_runtime_change_01",
  repositoryIdentityHash: `sha256:${"1".repeat(64)}`,
  destinationId: "hub:one",
};
afterEach(() => vi.useRealTimers());

describe("bounded runtime notification hints", () => {
  it("retains changes between waits and fans out workstream hints across destinations only in the same repository", async () => {
    const source = new RuntimeChangeNotifications();
    const signal = new AbortController().signal;
    const first = await source.waitForRuntimeChange({ ...scope, cursor: null, signal });
    source.notify({ ...scope, destinationId: "hub:other" });
    const second = await source.waitForRuntimeChange({ ...scope, cursor: first.cursor, signal });
    expect(second.status).toBe("changed");
    expect(second.cursor).not.toBe(first.cursor);
    vi.useFakeTimers();
    const waiting = source.waitForRuntimeChange({ ...scope, cursor: second.cursor, signal });
    source.notify({ ...scope, repositoryIdentityHash: `sha256:${"2".repeat(64)}` });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await waiting).toEqual({ ...second, status: "timeout" });
    source.close();
  });

  it("isolates command destinations and releases waits on abort, timeout, and close", async () => {
    vi.useFakeTimers();
    const source = new RuntimeChangeNotifications();
    const controller = new AbortController();
    const command = { ...scope, topic: "command" as const };
    const first = await source.waitForRuntimeChange({
      ...command,
      cursor: null,
      signal: controller.signal,
    });
    const waiting = source.waitForRuntimeChange({
      ...command,
      cursor: first.cursor,
      signal: controller.signal,
    });
    source.notify({ ...command, destinationId: "hub:other" });
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await waiting;
    expect(vi.getTimerCount()).toBe(0);
    const next = source.waitForRuntimeChange({
      ...command,
      cursor: first.cursor,
      signal: new AbortController().signal,
    });
    source.close();
    await next;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds retained keys and treats an evicted cursor or restarted source as a resync", async () => {
    const source = new RuntimeChangeNotifications();
    const signal = new AbortController().signal;
    const first = await source.waitForRuntimeChange({ ...scope, cursor: null, signal });
    for (let i = 0; i < 1_025; i += 1)
      await source.waitForRuntimeChange({
        ...scope,
        projectId: `prj_evicted_${i}`,
        cursor: null,
        signal,
      });
    expect(
      (await source.waitForRuntimeChange({ ...scope, cursor: first.cursor, signal })).cursor,
    ).not.toBe(first.cursor);
    source.close();
    expect(
      (
        await new RuntimeChangeNotifications().waitForRuntimeChange({
          ...scope,
          cursor: first.cursor,
          signal,
        })
      ).status,
    ).toBe("changed");
  });
});
