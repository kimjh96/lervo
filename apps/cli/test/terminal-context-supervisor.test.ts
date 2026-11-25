import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import {
  superviseTerminalContextServer,
  type TerminalContextRuntime,
} from "../src/terminal-context-supervisor.js";

const stores: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(stores.splice(0).map((store) => rm(store, { recursive: true, force: true })));
});

async function storeWith(hash: string | null) {
  const store = await mkdtemp(resolve(tmpdir(), "lvsup-"));
  stores.push(store);
  if (hash !== null) await point(store, hash);
  return store;
}

async function point(store: string, character: string) {
  await writeFile(
    resolve(store, "current.json"),
    JSON.stringify({
      schemaVersion: 1,
      contentHash: `sha256:${character.repeat(64)}`,
      directory: character.repeat(16),
    }),
  );
}

/** A server process stand-in that exits when killed or when the test says so. */
function fakeStart() {
  const started: { runtime: TerminalContextRuntime; child: ChildProcess }[] = [];
  const start = vi.fn((runtime: TerminalContextRuntime) => {
    const child = new EventEmitter() as ChildProcess & { exitCode: number | null };
    Object.assign(child, {
      exitCode: null,
      kill: () => {
        child.exitCode = 0;
        child.emit("exit", 0);
        child.emit("close", 0);
        return true;
      },
    });
    started.push({ runtime, child });
    return child;
  });
  return { start, started };
}

it("runs one server from the store's runtime and replaces it when the runtime changes", async () => {
  const store = await storeWith("a");
  const { start, started } = fakeStart();
  const supervisor = superviseTerminalContextServer({ store, start, supports: async () => true });
  await supervisor.ensure();
  await supervisor.ensure();
  expect(started).toHaveLength(1);
  expect(started[0]!.runtime).toEqual({
    entry: resolve(store, "a".repeat(16), "runtime-v2.mjs"),
    contentHash: `sha256:${"a".repeat(64)}`,
  });
  await point(store, "b");
  await supervisor.ensure();
  expect(started).toHaveLength(2);
  expect(started[0]!.child.exitCode).toBe(0);
  expect(started[1]!.runtime.contentHash).toBe(`sha256:${"b".repeat(64)}`);
  await supervisor.stop();
  expect(started[1]!.child.exitCode).toBe(0);
});

it("starts one server when checks overlap", async () => {
  const store = await storeWith("a");
  const { start, started } = fakeStart();
  const supervisor = superviseTerminalContextServer({ store, start, supports: async () => true });
  await Promise.all([supervisor.ensure(), supervisor.ensure(), supervisor.ensure()]);
  expect(started).toHaveLength(1);
  await supervisor.stop();
});

it("starts no server once stopped, even from a check already running", async () => {
  const store = await storeWith("a");
  const { start, started } = fakeStart();
  const supervisor = superviseTerminalContextServer({ store, start, supports: async () => true });
  const running = supervisor.ensure();
  await supervisor.stop();
  await running;
  expect(started).toHaveLength(0);
});

it("restarts a server that exits, backing off while it keeps failing", async () => {
  vi.useFakeTimers();
  const store = await storeWith("a");
  const { start, started } = fakeStart();
  let clock = 0;
  const supervisor = superviseTerminalContextServer({
    store,
    start,
    now: () => clock,
    supports: async () => true,
  });
  await supervisor.ensure();
  started[0]!.child.emit("close", 1);
  await vi.advanceTimersByTimeAsync(399);
  expect(started).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() => expect(started).toHaveLength(2));
  // One that served for a while restarts at the first delay again.
  clock += 120_000;
  started[1]!.child.emit("close", 0);
  await vi.advanceTimersByTimeAsync(200);
  await vi.waitFor(() => expect(started).toHaveLength(3));
  await supervisor.stop();
});

it("starts nothing without a runtime, and nothing after it stopped", async () => {
  const store = await storeWith(null);
  const { start, started } = fakeStart();
  const supervisor = superviseTerminalContextServer({ store, start, supports: async () => true });
  await supervisor.ensure();
  expect(started).toHaveLength(0);
  await point(store, "a");
  await supervisor.stop();
  await supervisor.ensure();
  expect(started).toHaveLength(0);
});

it("keeps restarting after a spawn that failed, which emits no exit", async () => {
  vi.useFakeTimers();
  const store = await storeWith("a");
  const { start, started } = fakeStart();
  const supervisor = superviseTerminalContextServer({ store, start, supports: async () => true });
  await supervisor.ensure();
  started[0]!.child.emit("error", Object.assign(new Error("spawn"), { code: "ENOENT" }));
  started[0]!.child.emit("close", -2);
  await vi.advanceTimersByTimeAsync(400);
  await vi.waitFor(() => expect(started).toHaveLength(2));
  await supervisor.stop();
});

it("starts no runtime that lacks the server mode", async () => {
  const store = await storeWith("a");
  const { start, started } = fakeStart();
  const supports = vi.fn(async () => false);
  const supervisor = superviseTerminalContextServer({ store, start, supports });
  await supervisor.ensure();
  await supervisor.ensure();
  expect(started).toHaveLength(0);
  // Asked once per runtime, not on every scan.
  expect(supports).toHaveBeenCalledTimes(1);
  await supervisor.stop();
});
