import { fork, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { startKnowledgeWorkerProcess } from "../src/knowledge-worker-process.js";

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps the parent responsive during real child CPU work and waits for child cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "lervo-owned-knowledge-"));
  roots.push(root);
  const entry = join(root, "worker.mjs");
  await writeFile(
    entry,
    `
    process.on('message', message => {
      if (message.type !== 'knowledge_worker_stop') return;
      process.send({ type: 'cleanup_started' });
      setTimeout(() => process.disconnect(), 30);
    });
    process.on('disconnect', () => process.exit(0));
    process.send({ type: 'busy' });
    const until = Date.now() + 500;
    while (Date.now() < until) {}
    process.send({ type: 'done' });
  `,
  );
  let child: ChildProcess | undefined;
  const failures: unknown[] = [];
  const stop = startKnowledgeWorkerProcess(
    { entry, repositoryRoot: root, provider: "codex", onFailure: (e) => failures.push(e) },
    ((...args: Parameters<typeof fork>) => (child = fork(...args))) as typeof fork,
  );
  try {
    expect(child?.pid).not.toBe(process.pid);
    const messages: string[] = [];
    child!.on("message", (message) => messages.push((message as { type: string }).type));
    await once(child!, "message");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(messages).toEqual(["busy"]);
    const stopping = stop();
    expect(stop()).toBe(stopping);
    await stopping;
    expect(messages).toEqual(["busy", "done", "cleanup_started"]);
    expect(child!.exitCode).toBe(0);
    expect(failures).toEqual([]);
  } finally {
    await stop();
  }
});

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    connected: true,
    send: vi.fn((_message: unknown, callback: (error: Error | null) => void) => callback(null)),
    kill: vi.fn(),
  }) as unknown as ChildProcess;
}

it("does not duplicate a live owner and retries an exited child only after the bounded delay", async () => {
  vi.useFakeTimers();
  const child = fakeChild();
  const launch = vi.fn(() => child) as unknown as typeof fork;
  const failures: Array<{ code: string }> = [];
  const stop = startKnowledgeWorkerProcess(
    {
      entry: "/runtime/bin.js",
      repositoryRoot: "/repository",
      provider: "codex",
      onFailure: (error) => failures.push(error as { code: string }),
    },
    launch,
  );
  await vi.advanceTimersByTimeAsync(120_000);
  expect(launch).toHaveBeenCalledTimes(1);
  child.emit("close", 1);
  expect(failures.map((e) => e.code)).toEqual(["knowledge_worker_process_exited"]);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(launch).toHaveBeenCalledTimes(1);
  await stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(launch).toHaveBeenCalledTimes(1);
});

it("aborts ownership gracefully and keeps shutdown pending until the child actually closes", async () => {
  const signal = new AbortController();
  const child = fakeChild();
  const stop = startKnowledgeWorkerProcess(
    {
      entry: "/runtime/bin.js",
      repositoryRoot: "/repository",
      provider: "codex",
      signal: signal.signal,
      onFailure: () => undefined,
    },
    (() => child) as typeof fork,
  );
  signal.abort();
  let stopped = false;
  const pending = stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  expect(child.send).toHaveBeenCalledTimes(1);
  child.emit("close", 0);
  await pending;
  expect(stopped).toBe(true);
  expect(child.kill).not.toHaveBeenCalled();
});

it("does not launch an already aborted owner", async () => {
  const signal = new AbortController();
  signal.abort();
  const launch = vi.fn();
  await startKnowledgeWorkerProcess(
    {
      entry: "/runtime/bin.js",
      repositoryRoot: "/repository",
      provider: "codex",
      signal: signal.signal,
      onFailure: () => undefined,
    },
    launch as typeof fork,
  )();
  expect(launch).not.toHaveBeenCalled();
});
