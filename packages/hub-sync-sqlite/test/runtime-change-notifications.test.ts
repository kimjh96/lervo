import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HUB_PRESENCE_GRACE_MILLISECONDS,
  MAXIMUM_HOSTS_PER_SCOPE,
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

  it("bounds an open hold at ten minutes and never wakes the host that made the change", async () => {
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
    // One timer: the ten-minute bound that reclaims a waiter whose connection died unseen.
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
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
    const bounded = source.waitForRuntimeChange({
      ...knowledge,
      cursor: (await source.waitForRuntimeChange({ ...knowledge, cursor: null, signal })).cursor,
      signal,
      hold: "open",
    });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await bounded).toMatchObject({ status: "timeout" });
    source.close();
  });

  it("names the kinds changed since a host's last answer, once", async () => {
    const source = new RuntimeChangeNotifications();
    const signal = new AbortController().signal;
    const first = await source.waitForRuntimeChange({
      ...knowledge,
      cursor: null,
      signal,
      hostHash: wsl,
    });
    source.notify(knowledge, mac, ["host"]);
    source.notify(knowledge, mac, ["lease"]);
    source.notify(knowledge, mac, ["host"]);
    const changed = await source.waitForRuntimeChange({
      ...knowledge,
      cursor: first.cursor,
      signal,
      hostHash: wsl,
    });
    expect(changed).toMatchObject({ status: "changed", kinds: ["host", "lease"] });
    source.notify(knowledge, mac, ["presence"]);
    expect(
      await source.waitForRuntimeChange({
        ...knowledge,
        cursor: changed.cursor,
        signal,
        hostHash: wsl,
      }),
    ).toMatchObject({ kinds: ["presence"] });
    source.close();
  });

  it("still names a lease change whose answer was lost, after later changes (ADR-0602)", async () => {
    const source = new RuntimeChangeNotifications();
    const signal = new AbortController().signal;
    const wait = (cursor: string | null) =>
      source.waitForRuntimeChange({ ...knowledge, cursor, signal, hostHash: wsl });
    const first = await wait(null);
    // Caught up at `first`: its held wait is answered with the lease change, which never arrives.
    const held = wait(first.cursor);
    source.notify(knowledge, mac, ["lease"]);
    expect(await held).toMatchObject({ kinds: ["lease"] });
    source.notify(knowledge, mac, ["presence"]);
    // The host reconnects with the cursor it still holds, and is told both.
    expect(await wait(first.cursor)).toMatchObject({ kinds: ["lease", "presence"] });
    // A cursor the Hub has no record for is told no kinds: anything may have changed.
    const unknown = await wait("00000000-0000-4000-8000-000000000000");
    expect(unknown).toMatchObject({ status: "changed" });
    expect(unknown).not.toHaveProperty("kinds");
    source.close();
  });

  it("forgets the host that waited least recently past the per-scope cap, which then runs a full cycle", async () => {
    const source = new RuntimeChangeNotifications();
    const signal = new AbortController().signal;
    const host = (index: number) => `sha256:${index.toString(16).padStart(64, "0")}`;
    const wait = (hostHash: string, cursor: string | null) =>
      source.waitForRuntimeChange({ ...knowledge, cursor, signal, hostHash });
    const forgotten = await wait(wsl, null);
    source.notify(knowledge, mac, ["host"]);
    for (let index = 1; index < MAXIMUM_HOSTS_PER_SCOPE; index++) await wait(host(index), null);
    // One more host makes room by forgetting wsl, the one that waited least recently.
    await wait(host(MAXIMUM_HOSTS_PER_SCOPE), null);
    const returned = await wait(wsl, forgotten.cursor);
    expect(returned).toMatchObject({ status: "changed" });
    expect(returned).not.toHaveProperty("kinds");
    source.close();
  });

  it("never forgets a host that is waiting, and refuses a new one while every host waits", async () => {
    const source = new RuntimeChangeNotifications();
    const host = (index: number) => `sha256:${index.toString(16).padStart(64, "0")}`;
    type Hold = { stop: AbortController; held: Promise<unknown>; answered: string | null };
    const holds: Hold[] = [];
    const hold = (entry: Hold, index: number, cursor: string | null) => {
      entry.answered = null;
      entry.held = source
        .waitForRuntimeChange({
          ...knowledge,
          cursor,
          signal: entry.stop.signal,
          hostHash: host(index),
        })
        .then(
          (answer) => {
            entry.answered = answer.cursor;
          },
          () => undefined,
        );
    };
    for (let index = 0; index < MAXIMUM_HOSTS_PER_SCOPE; index++) {
      const entry: Hold = { stop: new AbortController(), held: Promise.resolve(), answered: null };
      holds.push(entry);
      hold(entry, index, null);
      await entry.held;
      hold(entry, index, entry.answered);
    }
    // Each arrival woke the hosts already waiting; they wait again until every one is held.
    for (let round = 0; round < 10; round++) {
      await new Promise((settle) => setImmediate(settle));
      const woken = holds.filter((entry) => entry.answered !== null);
      if (woken.length === 0) break;
      for (const entry of woken) hold(entry, holds.indexOf(entry), entry.answered);
    }
    expect(holds.every((entry) => entry.answered === null)).toBe(true);
    const signal = new AbortController().signal;
    await expect(
      source.waitForRuntimeChange({ ...knowledge, cursor: null, signal, hostHash: wsl }),
    ).rejects.toMatchObject({ code: "capacity_exceeded" });
    // Once one host stops waiting, it is the one forgotten.
    holds[0]!.stop.abort();
    await holds[0]!.held;
    await expect(
      source.waitForRuntimeChange({ ...knowledge, cursor: null, signal, hostHash: wsl }),
    ).resolves.toMatchObject({ status: "changed" });
    for (const { stop } of holds) stop.abort();
    await Promise.all(holds.map(({ held }) => held));
    source.close();
  });

  it("tells peers the lease changed when its holder arrives or leaves (ADR-0602)", async () => {
    vi.useFakeTimers();
    const holder = mac;
    const source = new RuntimeChangeNotifications(Date.now, (_scope, host) =>
      host === holder ? ["lease"] : [],
    );
    const signal = new AbortController().signal;
    const wslFirst = await source.waitForRuntimeChange({
      ...knowledge,
      cursor: null,
      signal,
      hostHash: wsl,
    });
    const arrived = source.waitForRuntimeChange({
      ...knowledge,
      cursor: wslFirst.cursor,
      signal,
      hostHash: wsl,
    });
    const leave = new AbortController();
    const macFirst = await source.waitForRuntimeChange({
      ...knowledge,
      cursor: null,
      signal: leave.signal,
      hostHash: mac,
    });
    void source
      .waitForRuntimeChange({
        ...knowledge,
        cursor: macFirst.cursor,
        signal: leave.signal,
        hostHash: mac,
      })
      .catch(() => undefined);
    const told = await arrived;
    expect(told.kinds).toEqual(["lease", "presence"]);
    const departed = source.waitForRuntimeChange({
      ...knowledge,
      cursor: told.cursor,
      signal,
      hostHash: wsl,
    });
    leave.abort();
    await vi.advanceTimersByTimeAsync(HUB_PRESENCE_GRACE_MILLISECONDS + 1);
    expect(await departed).toMatchObject({ kinds: ["lease", "presence"] });
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
    // Never seen waiting (an earlier release names no host): unknown, never absent.
    expect(source.hostPresence(coordinate, wsl)).toBeNull();
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
    expect(source.hostPresence(coordinate, wsl)?.connected).toBe(true);
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
