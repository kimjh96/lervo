import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { subscribeKnowledgeWakeups } from "../src/knowledge-worker-wakeups.js";

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storage() {
  const root = await mkdtemp(join(tmpdir(), "lervo-knowledge-wakeups-"));
  roots.push(root);
  return {
    paths: { repositoryRoot: root, eventDatabase: join(root, "events.sqlite") },
    events: { latest: () => null },
  } as never;
}

it("wakes on repository edits, retries a failed watcher and stops every subscription", async () => {
  vi.useFakeTimers();
  const notify = vi.fn();
  const stops: ReturnType<typeof vi.fn>[] = [];
  const failures: (() => void)[] = [];
  const watch = vi.fn(async (_root: string, changed: () => void, failed?: () => void) => {
    changed();
    failures.push(failed!);
    const stop = vi.fn();
    stops.push(stop);
    return stop;
  });
  const unsubscribe = subscribeKnowledgeWakeups(await storage(), notify, watch);
  await vi.waitFor(() => expect(stops).toHaveLength(1));
  expect(watch.mock.calls[0]![0]).toBe(roots[0]);
  expect(notify).toHaveBeenCalledTimes(1);

  failures[0]!();
  expect(notify).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.waitFor(() => expect(stops).toHaveLength(2));

  unsubscribe();
  expect(stops[1]).toHaveBeenCalledTimes(1);
});

it("retries a watcher that cannot start", async () => {
  vi.useFakeTimers();
  const notify = vi.fn();
  let attempts = 0;
  const watch = vi.fn(async () => {
    attempts++;
    if (attempts === 1) throw new Error("watch limit");
    return () => undefined;
  });
  const unsubscribe = subscribeKnowledgeWakeups(await storage(), notify, watch);
  await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(attempts).toBe(2);
  unsubscribe();
});

it("backs a watcher that keeps failing to start off exponentially, and resets once it arms (ADR-0602)", async () => {
  vi.useFakeTimers();
  let attempts = 0;
  const startedAt: number[] = [];
  const watch = vi.fn(async () => {
    attempts++;
    startedAt.push(Date.now());
    if (attempts <= 6) throw Object.assign(new Error("watch limit"), { code: "ENOSPC" });
    return () => undefined;
  });
  const start = Date.now();
  const unsubscribe = subscribeKnowledgeWakeups(await storage(), vi.fn(), watch);
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  // 1, 2, 4, 8, 15 and 15 minutes apart: never a fixed minute while the limit stays hit.
  expect(startedAt.map((at) => (at - start) / 60_000)).toEqual([0, 1, 3, 7, 15, 30, 45]);
  expect(vi.getTimerCount()).toBe(0);
  unsubscribe();
});
