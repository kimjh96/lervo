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
