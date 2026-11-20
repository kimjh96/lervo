import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HUB_PRESENCE_GRACE_MILLISECONDS,
  RuntimeChangeNotifications,
} from "../src/runtime-change-notifications.js";

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

describe("knowledge change waits (ADR-0602)", () => {
  const knowledge = { ...scope, topic: "knowledge" as const };
  const mac = `sha256:${"a".repeat(64)}`;
  const wsl = `sha256:${"b".repeat(64)}`;

  it("arms no timer for an open hold and never wakes the host that made the change", async () => {
    vi.useFakeTimers();
    const source = new RuntimeChangeNotifications();
    const signal = new AbortController().signal;
    const first = await source.waitForRuntimeChange({ ...knowledge, cursor: null, signal });
    const waiting = source.waitForRuntimeChange({
      ...knowledge,
      cursor: first.cursor,
      signal,
      hold: "open",
    });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    // mac's own change leaves mac's cursor alone, and wakes the hostless wait.
    const own = await source.waitForRuntimeChange({
      ...knowledge,
      cursor: null,
      signal,
      hostHash: mac,
    });
    source.notify(knowledge, mac);
    const after = await source.waitForRuntimeChange({
      ...knowledge,
      cursor: null,
      signal,
      hostHash: mac,
    });
    expect(after.cursor).toBe(own.cursor);
    expect(await waiting).toMatchObject({ status: "changed" });
    source.close();
  });

  it("reports presence by the Hub's clock and wakes peers only after a departure outlasts the grace", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-20T00:00:00.000Z") });
    const source = new RuntimeChangeNotifications();
    const signal = new AbortController().signal;
    const coordinate = {
      projectId: knowledge.projectId,
      repositoryIdentityHash: knowledge.repositoryIdentityHash,
      destinationId: knowledge.destinationId,
    };
    expect(source.hostPresence(coordinate, wsl)).toEqual({
      connected: false,
      since: "2026-11-20T00:00:00.000Z",
    });
    const peer = await source.waitForRuntimeChange({
      ...knowledge,
      cursor: null,
      signal,
      hostHash: mac,
    });
    const wslFirst = await source.waitForRuntimeChange({
      ...knowledge,
      cursor: null,
      signal,
      hostHash: wsl,
    });
    const leave = new AbortController();
    await vi.advanceTimersByTimeAsync(1_000);
    const held = source.waitForRuntimeChange({
      ...knowledge,
      cursor: wslFirst.cursor,
      signal: leave.signal,
      hostHash: wsl,
      hold: "open",
    });
    expect(source.hostPresence(coordinate, wsl)).toEqual({
      connected: true,
      since: "2026-11-20T00:00:01.000Z",
    });
    // The connection changed what mac reads, so mac's cursor moved.
    const macChanged = await source.waitForRuntimeChange({
      ...knowledge,
      cursor: peer.cursor,
      signal,
      hostHash: mac,
    });
    expect(macChanged.status).toBe("changed");
    leave.abort();
    await held;
    // A departure shorter than the grace is the gap between two waits: no change.
    await vi.advanceTimersByTimeAsync(HUB_PRESENCE_GRACE_MILLISECONDS - 1);
    expect(source.hostPresence(coordinate, wsl).connected).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(source.hostPresence(coordinate, wsl)).toEqual({
      connected: false,
      since: new Date(Date.now()).toISOString(),
    });
    const macAgain = await source.waitForRuntimeChange({
      ...knowledge,
      cursor: macChanged.cursor,
      signal,
      hostHash: mac,
    });
    expect(macAgain.status).toBe("changed");
    expect(vi.getTimerCount()).toBe(0);
    source.close();
  });
});
